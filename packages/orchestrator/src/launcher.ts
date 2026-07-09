import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "@relay/schema";
import { buildAgentPrompt, buildLaunchArgs } from "./launch-args.js";

export type LaunchRequest = {
  cwd: string;
  harness: HarnessId;
  binary: string;
  task: string;
  handoffPath: string;
  interactive?: boolean;
};

export type LaunchResult = {
  launched: boolean;
  message: string;
  pid?: number;
};

async function writePromptFile(cwd: string, prompt: string): Promise<string> {
  const dir = join(cwd, ".relay", "launch");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "prompt.txt");
  await writeFile(file, prompt, "utf8");
  return file;
}

function buildPrompt(task: string, handoffPath: string): string {
  return buildAgentPrompt(task, handoffPath, false);
}

/** Spawn a harness CLI with the handoff prompt, or return manual instructions. */
export async function launchHarness(request: LaunchRequest): Promise<LaunchResult> {
  const prompt = buildPrompt(request.task, request.handoffPath);
  await writePromptFile(request.cwd, prompt);
  const args = buildLaunchArgs(request.harness, prompt);

  return new Promise((resolve) => {
    const child = spawn(request.binary, args, {
      cwd: request.cwd,
      stdio: request.interactive ? "inherit" : "pipe",
      env: {
        ...process.env,
        RELAY_HANDOFF_PATH: request.handoffPath,
        RELAY_TASK: request.task,
        RELAY_HARNESS: request.harness,
      },
    });

    child.on("error", (error) => {
      resolve({
        launched: false,
        message: `Could not launch ${request.binary}: ${error.message}. Open ${request.harness} manually and read ${request.handoffPath}.`,
      });
    });

    child.on("spawn", () => {
      if (request.interactive) {
        resolve({
          launched: true,
          pid: child.pid,
          message: `Launched ${request.binary} (pid ${child.pid}) for ${request.harness}. When done, run: relay run --next --launch`,
        });
      }
    });

    if (!request.interactive) {
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({
            launched: true,
            message: `${request.harness} completed step successfully.`,
          });
          return;
        }

        resolve({
          launched: false,
          message:
            stderr.trim() ||
            `${request.binary} exited with code ${code ?? "unknown"}. Open ${request.harness} manually and read ${request.handoffPath}.`,
        });
      });
    }
  });
}

export function formatManualLaunch(harness: HarnessId, handoffPath: string, task: string): string {
  return `Open ${harness}, read ${handoffPath}, then: ${task}`;
}
