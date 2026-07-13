import { type ChildProcess, spawn } from "node:child_process";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";
import { buildAgentPrompt } from "../launch-args.js";
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

function buildPrompt(task: string, handoffPath: string): string {
  return buildAgentPrompt(task, handoffPath);
}

function formatPiEvent(event: Record<string, unknown>): string | null {
  const type = event.type;
  if (type === "tool_execution_start") {
    const name = typeof event.toolName === "string" ? event.toolName : "tool";
    return `tool ▶ ${name}`;
  }
  if (type === "tool_execution_end") {
    const name = typeof event.toolName === "string" ? event.toolName : "tool";
    const isError = event.isError === true;
    return isError ? `tool ✗ ${name}` : `tool ✓ ${name}`;
  }
  if (type === "message_update") {
    const role = typeof event.role === "string" ? event.role : "assistant";
    return role === "assistant" ? null : `message (${role})`;
  }
  if (type === "agent_start") return "agent started";
  if (type === "agent_end") return "agent turn complete";
  if (type === "auto_retry_start") return "retrying…";
  if (type === "auto_retry_end") return "retry done";
  return null;
}

export class PiRpcDriver implements HarnessDriver {
  readonly kind = "pi-rpc" as const;

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    const prompt = buildPrompt(request.task, request.handoffPath);
    const timeoutMs = request.timeoutMs ?? 15 * 60 * 1000;

    return new Promise((resolve) => {
      let settled = false;
      let stderr = "";
      let lastAssistant: string | null = null;
      const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
      let reqId = 0;

      const finish = (result: HarnessRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        detachReader?.();
        resolve(result);
      };

      const child: ChildProcess = spawn(
        request.binary,
        request.model
          ? ["--mode", "rpc", "--no-session", "--model", request.model]
          : ["--mode", "rpc", "--no-session"],
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
          },
        },
      );

      const send = (body: Record<string, unknown>) => {
        const id = `relay-${++reqId}`;
        child.stdin?.write(serializeJsonLine({ id, ...body }));
        return id;
      };

      const onAbort = () => {
        finish({ ok: false, harness: request.harness, summary: "Cancelled." });
      };

      const timer = setTimeout(() => {
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

      let detachReader: (() => void) | undefined;
      if (child.stdout) {
        detachReader = attachJsonlLineReader(child.stdout, (line) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            return;
          }

          if (parsed.type === "response") {
            const id = typeof parsed.id === "string" ? parsed.id : "";
            const pendingReq = pending.get(id);
            if (pendingReq) {
              pending.delete(id);
              if (parsed.success === false) {
                pendingReq.reject(new Error(String(parsed.error ?? "Pi RPC error")));
              } else {
                pendingReq.resolve(parsed);
              }
            }
            return;
          }

          const formatted = formatPiEvent(parsed);
          if (formatted) request.onEvent?.(formatted);

          if (parsed.type === "message_end" && parsed.role === "assistant") {
            const message = parsed.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
            const text = message?.content
              ?.filter((part) => part.type === "text" && part.text)
              .map((part) => part.text)
              .join("\n");
            if (text) lastAssistant = text;
          }

          if (parsed.type === "agent_settled") {
            finish({
              ok: true,
              harness: request.harness,
              summary: "Pi finished.",
              output: lastAssistant?.split("\n").slice(-4).join("\n") || undefined,
            });
          }
        });
      }

      const promptId = send({ type: "prompt", message: prompt });

      pending.set(promptId, {
        resolve: () => {
          request.onEvent?.("prompt accepted — agent running…");
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
        finish({
          ok: code === 0,
          harness: request.harness,
          summary: code === 0 ? "Pi exited." : `Pi exited with code ${code ?? "?"}`,
          output: stderr.trim() || lastAssistant || undefined,
        });
      });
    });
  }
}
