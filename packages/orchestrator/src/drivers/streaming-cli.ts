import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessEvent, HarnessId } from "@relay/schema";
import { buildAgentPrompt, buildLaunchArgs } from "../launch-args.js";
import { HarnessEventEmitter } from "../events.js";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";

export type ParsedToolLine = {
  toolName: string;
  args?: Record<string, unknown>;
} | null;

function now(): string {
  return new Date().toISOString();
}

function cleanAgentEnv(): NodeJS.ProcessEnv {
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

function emitLines(buffer: string, onOutput?: (line: string) => void): string {
  if (!onOutput) return buffer;
  const parts = buffer.split("\n");
  for (let i = 0; i < parts.length - 1; i++) {
    const line = parts[i]!.trimEnd();
    if (line) onOutput(line);
  }
  return parts[parts.length - 1] ?? "";
}

function killChild(child: ChildProcess): void {
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

/** Shared CLI harness driver with structured event streaming and cancel. */
export abstract class StreamingCliDriver implements HarnessDriver {
  readonly kind = "cli" as const;

  abstract readonly harness: HarnessId;

  /** Parse a stdout line into a tool event, if recognized. */
  abstract parseToolLine(line: string): ParsedToolLine;

  private readonly emitter = new HarnessEventEmitter();
  private cancelFn: (() => void) | null = null;

  streamEvents(handler: (event: HarnessEvent) => void): () => void {
    return this.emitter.on(handler);
  }

  cancel(): void {
    this.cancelFn?.();
  }

  protected emit(event: HarnessEvent, request: DriverRequest): void {
    this.emitter.emit(event);
    request.onEvent?.(event);
  }

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    const prompt = buildAgentPrompt(request.task, request.handoffPath);
    const dir = join(request.cwd, ".relay", "launch");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.txt"), prompt, "utf8");

    const args = buildLaunchArgs(request.harness, prompt, request.model);
    const timeoutMs = request.timeoutMs ?? 10 * 60 * 1000;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let stdoutPartial = "";
      let stderrPartial = "";
      let settled = false;
      let child: ChildProcess;
      const openTools = new Map<string, string>();

      const finish = (result: HarnessRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelFn = null;
        request.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = () => {
        killChild(child);
        finish({ ok: false, harness: request.harness, summary: "Cancelled." });
      };

      this.cancelFn = onAbort;

      child = spawn(request.binary, args, {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: {
          ...cleanAgentEnv(),
          RELAY_HANDOFF_PATH: request.handoffPath,
          RELAY_TASK: request.task,
          RELAY_HARNESS: request.harness,
          ...(request.model ? { RELAY_MODEL: request.model } : {}),
        },
      });

      const timer = setTimeout(() => {
        killChild(child);
        finish({
          ok: false,
          harness: request.harness,
          summary: `${request.harness} timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);

      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      request.signal?.addEventListener("abort", onAbort, { once: true });

      this.emit({ type: "agent_start", at: now(), harness: request.harness }, request);

      const handleLine = (line: string, isStderr = false) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (isStderr) {
          request.onLine?.(`[stderr] ${trimmed}`);
          return;
        }

        const parsed = this.parseToolLine(trimmed);
        if (parsed) {
          const toolCallId = `${parsed.toolName}-${openTools.size + 1}`;
          openTools.set(toolCallId, parsed.toolName);
          this.emit(
            {
              type: "tool_start",
              at: now(),
              toolName: parsed.toolName,
              toolCallId,
              args: parsed.args,
            },
            request,
          );
          this.emit(
            {
              type: "tool_end",
              at: now(),
              toolName: parsed.toolName,
              toolCallId,
              ok: true,
            },
            request,
          );
          return;
        }

        if (request.onEvent) {
          this.emit(
            {
              type: "agent_message",
              at: now(),
              role: "assistant",
              text: trimmed,
              delta: true,
            },
            request,
          );
          return;
        }

        request.onLine?.(trimmed);
      };

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        stdoutPartial = emitLines(stdoutPartial + text, (line) => handleLine(line));
      });

      child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        stderrPartial = emitLines(stderrPartial + text, (line) => handleLine(line, true));
      });

      child.on("error", (error) => {
        finish({
          ok: false,
          harness: request.harness,
          summary: `Could not run ${request.binary}: ${error.message}`,
        });
      });

      child.on("close", (code) => {
        this.emit({ type: "agent_end", at: now(), harness: request.harness }, request);
        const tail = (stdout || stderr).trim().split("\n").slice(-6).join("\n");
        if (code === 0) {
          finish({
            ok: true,
            harness: request.harness,
            summary: `${request.harness} finished.`,
            output: tail || undefined,
            toolCallCount: openTools.size,
          });
          return;
        }

        finish({
          ok: false,
          harness: request.harness,
          summary: `${request.harness} failed (exit ${code ?? "?"}).`,
          output: tail || stderr.trim() || undefined,
          toolCallCount: openTools.size > 0 ? openTools.size : undefined,
        });
      });
    });
  }
}

const ACTION_PATTERN =
  /^(?:\[?(Read|Write|Edit|Bash|Glob|Grep|Search|Shell|Run)\]?|(Reading|Writing|Editing|Running))\s*[:\s]+(.+)$/i;

export function parseGenericToolLine(line: string): ParsedToolLine {
  const match = line.trim().match(ACTION_PATTERN);
  if (!match) return null;

  const rawName = (match[1] ?? match[2] ?? "").toLowerCase();
  const detail = match[3]!.trim();
  const toolName =
    rawName === "reading"
      ? "read"
      : rawName === "writing" || rawName === "editing"
        ? "write"
        : rawName === "running" || rawName === "run" || rawName === "shell"
          ? "bash"
          : rawName;

  const args =
    toolName === "bash"
      ? { command: detail }
      : toolName === "read" || toolName === "write"
        ? { path: detail.split(/\s+/)[0] }
        : { target: detail };

  return { toolName, args };
}
