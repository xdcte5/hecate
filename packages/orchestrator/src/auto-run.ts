import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "@relay/schema";
import { buildAgentPrompt, buildLaunchArgs } from "./launch-args.js";

export type AutoRunRequest = {
  cwd: string;
  harness: HarnessId;
  binary: string;
  task: string;
  handoffPath: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onOutput?: (line: string) => void;
};

export type AutoRunResult = {
  ok: boolean;
  summary: string;
  output?: string;
};

function buildPrompt(task: string, handoffPath: string): string {
  return buildAgentPrompt(task, handoffPath);
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

/** Run a harness non-interactively, stream output, and wait for completion. */
export async function runHarnessAuto(request: AutoRunRequest): Promise<AutoRunResult> {
  const prompt = buildPrompt(request.task, request.handoffPath);
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

    const finish = (result: AutoRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (request.signal) {
        request.signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };

    const onAbort = () => {
      killChild(child);
      finish({ ok: false, summary: "Cancelled." });
    };

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
        summary: `${request.harness} timed out after ${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    if (request.signal?.aborted) {
      onAbort();
      return;
    }
    request.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      stdoutPartial = emitLines(stdoutPartial + text, request.onOutput);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      stderrPartial = emitLines(stderrPartial + text, (line) => {
        request.onOutput?.(`[stderr] ${line}`);
      });
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        summary: `Could not run ${request.binary}: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      const tail = (stdout || stderr).trim().split("\n").slice(-6).join("\n");
      if (code === 0) {
        finish({
          ok: true,
          summary: `${request.harness} finished.`,
          output: tail || undefined,
        });
        return;
      }

      finish({
        ok: false,
        summary: `${request.harness} failed (exit ${code ?? "?"}).`,
        output: tail || stderr.trim() || undefined,
      });
    });
  });
}
