import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunState, RunStep } from "./types.js";

export function runStatePath(cwd: string, sessionId: string): string {
  return join(cwd, ".relay", "sessions", sessionId, "run-state.json");
}

export async function loadRunState(cwd: string, sessionId: string): Promise<RunState | null> {
  try {
    const raw = await readFile(runStatePath(cwd, sessionId), "utf8");
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

export async function saveRunState(cwd: string, state: RunState): Promise<void> {
  const path = runStatePath(cwd, state.sessionId);
  await mkdir(join(cwd, ".relay", "sessions", state.sessionId), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function initRunState(goal: string, sessionId: string, steps: RunStep[]): RunState {
  const now = new Date().toISOString();
  return {
    version: 1,
    goal,
    sessionId,
    steps,
    currentStepIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
}
