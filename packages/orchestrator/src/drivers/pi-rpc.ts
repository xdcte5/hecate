import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "@relay/schema";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";
import { buildAgentPrompt } from "../launch-args.js";
import { mapPiEventToHarnessEvent, HarnessEventEmitter, type PiRpcEvent } from "../events.js";
import {
  buildPiSkillsEnv,
  formatSkillPromptSection,
  formatSkillsCatalog,
  loadRelaySkills,
} from "../skills-bridge.js";
import type { SteerQueue } from "../steer-queue.js";
import { listChangedFiles } from "../verify.js";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";

function cleanEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ZDOTDIR: "/dev/null",
    DOTENV_CONFIG_QUIET: "true",
    ZSH_DISABLE_COMPFIX: "true",
    CI: "true",
    NO_COLOR: "1",
    CLAUDE_CODE_ENTRYPOINT: "relay",
  };
}

function buildPiRpcArgs(model?: string): string[] {
  const base = ["--mode", "rpc", "--approve"];
  if (!model) return base;
  if (model.includes("/")) {
    const slash = model.indexOf("/");
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    return [...base, "--provider", provider, "--model", modelId];
  }
  return [...base, "--model", model];
}

function buildPrompt(
  task: string,
  handoffPath: string,
  skillsSection = "",
  skillSection = "",
): string {
  return [buildAgentPrompt(task, handoffPath), skillsSection, skillSection]
    .filter((part) => part.length > 0)
    .join("\n");
}

function resolveMcpConfigPath(cwd: string): string | undefined {
  const relayMcp = join(cwd, "relay", "mcp.json");
  if (existsSync(relayMcp)) return relayMcp;
  const rootMcp = join(cwd, "mcp.json");
  if (existsSync(rootMcp)) return rootMcp;
  return undefined;
}

/** Send abort RPC command when the run is cancelled. */
export function sendAbort(write: (body: Record<string, unknown>) => string): string {
  return write({ type: "abort" });
}

/** Send steer RPC command for mid-run follow-up messages. */
export function sendSteer(write: (body: Record<string, unknown>) => string, message: string): string {
  return write({ type: "steer", message });
}

function emitHarnessEvent(
  request: DriverRequest,
  event: HarnessEvent,
  emitter?: HarnessEventEmitter,
): void {
  emitter?.emit(event);
  request.onEvent?.(event);
}

export class PiRpcDriver implements HarnessDriver {
  readonly kind = "pi-rpc" as const;

  private readonly emitter = new HarnessEventEmitter();
  private cancelFn: (() => void) | null = null;

  streamEvents(handler: (event: HarnessEvent) => void): () => void {
    return this.emitter.on(handler);
  }

  cancel(): void {
    this.cancelFn?.();
  }

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    const skills = await loadRelaySkills(request.cwd);
    const skillsSection = formatSkillsCatalog(skills);
    const skillSection = formatSkillPromptSection(skills, request.activeSkill);
    const prompt = buildPrompt(request.task, request.handoffPath, skillsSection, skillSection);
    const skillsEnv = buildPiSkillsEnv(request.cwd, skills);
    const mcpConfig = resolveMcpConfigPath(request.cwd);
    const timeoutMs = request.timeoutMs ?? 15 * 60 * 1000;

    return new Promise((resolve) => {
      let settled = false;
      let stderr = "";
      let lastAssistant: string | null = null;
      let promptAccepted = false;
      let agentSettled = false;
      let runError: string | null = null;
      let toolCallCount = 0;
      let promptSent = false;
      const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
      let reqId = 0;
      let writeCommand: ((body: Record<string, unknown>) => string) | null = null;
      let detachReader: (() => void) | undefined;

      const emitLine = (line: string) => {
        request.onLine?.(line);
      };

      const finish = (result: HarnessRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelFn = null;
        request.signal?.removeEventListener("abort", onAbort);
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        detachReader?.();

        void (async () => {
          if (result.ok) {
            result.toolCallCount = toolCallCount;
            try {
              const files = await listChangedFiles(request.cwd);
              if (files.length > 0) result.filesTouched = files;
            } catch {
              // ignore git errors in test/sandbox environments
            }
          } else if (toolCallCount > 0) {
            result.toolCallCount = toolCallCount;
          }
          resolve(result);
        })();
      };

      const child: ChildProcess = spawn(
        request.binary,
        buildPiRpcArgs(request.model),
        {
          cwd: request.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          env: {
            ...cleanEnv(),
            RELAY_HANDOFF_PATH: request.handoffPath,
            RELAY_TASK: request.task,
            RELAY_HARNESS: request.harness,
            ...(request.model ? { RELAY_MODEL: request.model } : {}),
            ...skillsEnv,
            ...(mcpConfig ? { RELAY_MCP_CONFIG: mcpConfig } : {}),
          },
        },
      );

      writeCommand = (body: Record<string, unknown>) => {
        const id = `relay-${++reqId}`;
        child.stdin?.write(serializeJsonLine({ id, ...body }));
        return id;
      };

      const pumpSteer = async (queue: SteerQueue) => {
        while (!settled && !agentSettled) {
          const message = await queue.waitNext(request.signal);
          if (!message || settled) break;

          while (!promptAccepted && !settled && !agentSettled) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }

          if (writeCommand && promptAccepted && !agentSettled && !settled) {
            sendSteer(writeCommand, message);
            emitLine(`steer → ${message.length > 72 ? `${message.slice(0, 69)}…` : message}`);
          }
        }
      };

      if (request.steerQueue) {
        void pumpSteer(request.steerQueue);
      }

      const onAbort = () => {
        if (writeCommand && (promptAccepted || promptSent) && !agentSettled) {
          sendAbort(writeCommand);
        }
        finish({ ok: false, harness: request.harness, summary: "Cancelled." });
      };

      this.cancelFn = onAbort;

      const timer = setTimeout(() => {
        if (writeCommand && promptAccepted && !agentSettled) {
          sendAbort(writeCommand);
        }
        finish({
          ok: false,
          harness: request.harness,
          summary: `Pi timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);

      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      request.signal?.addEventListener("abort", onAbort, { once: true });

      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        finish({
          ok: false,
          harness: request.harness,
          summary: `Pi RPC failed: ${error.message}`,
          output: stderr.trim() || undefined,
        });
      });

      const handlePiEvent = (parsed: PiRpcEvent) => {
        const harnessEvent = mapPiEventToHarnessEvent(parsed, request.harness);
        if (harnessEvent) {
          emitHarnessEvent(request, harnessEvent, this.emitter);
        }

        if (parsed.type === "tool_execution_start") {
          toolCallCount += 1;
        }

        if (parsed.type === "message_update") {
          const assistantEvent = parsed.assistantMessageEvent as { type?: string; reason?: string } | undefined;
          if (assistantEvent?.type === "error") {
            runError = assistantEvent.reason ?? "Agent error";
          }
        }

        if (parsed.type === "auto_retry_end" && parsed.success === false) {
          runError = typeof parsed.finalError === "string" ? parsed.finalError : "Retry failed";
        }

        if (parsed.type === "extension_error") {
          runError = typeof parsed.error === "string" ? parsed.error : "Extension error";
        }

        if (parsed.type === "message_end") {
          const message = parsed.message as { role?: string; content?: Array<{ type?: string; text?: string }> } | undefined;
          if (message?.role === "assistant") {
            const text = message.content
              ?.filter((part) => part.type === "text" && part.text)
              .map((part) => part.text)
              .join("\n");
            if (text) lastAssistant = text;
          }
        }

        if (parsed.type === "agent_settled") {
          agentSettled = true;
          if (runError) {
            finish({
              ok: false,
              harness: request.harness,
              summary: runError,
              output: lastAssistant?.split("\n").slice(-4).join("\n") || stderr.trim() || undefined,
            });
            return;
          }
          finish({
            ok: true,
            harness: request.harness,
            summary: "Pi finished.",
            output: lastAssistant?.split("\n").slice(-4).join("\n") || undefined,
          });
        }
      };

      if (child.stdout) {
        detachReader = attachJsonlLineReader(child.stdout, (line) => {
          let parsed: PiRpcEvent;
          try {
            parsed = JSON.parse(line) as PiRpcEvent;
          } catch {
            return;
          }

          if (parsed.type === "response") {
            const id = typeof parsed.id === "string" ? parsed.id : "";
            const pendingReq = pending.get(id);
            if (pendingReq) {
              pending.delete(id);
              if (parsed.success === false) {
                runError = String(parsed.error ?? "Pi RPC error");
                pendingReq.reject(new Error(runError));
              } else {
                pendingReq.resolve(parsed);
              }
            }
            return;
          }

          handlePiEvent(parsed);
        });
      }

      const promptId = writeCommand({ type: "prompt", message: prompt });
      promptSent = true;

      pending.set(promptId, {
        resolve: () => {
          promptAccepted = true;
          emitLine("prompt accepted — agent running…");
        },
        reject: (error) => {
          finish({
            ok: false,
            harness: request.harness,
            summary: error.message,
            output: stderr.trim() || undefined,
          });
        },
      });

      child.on("exit", (code) => {
        if (settled) return;
        if (agentSettled) return;
        const summary = !promptAccepted
          ? `Pi exited before prompt was accepted (code ${code ?? "?"})`
          : `Pi exited before agent settled (code ${code ?? "?"})`;
        finish({
          ok: false,
          harness: request.harness,
          summary,
          output: stderr.trim() || lastAssistant || undefined,
        });
      });
    });
  }
}
