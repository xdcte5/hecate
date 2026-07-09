import { buildProject } from "@relay/adapters";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import type { HarnessId } from "@relay/schema";
import { SessionStore, getHandoffPath } from "@relay/session";
import { runHarnessAuto } from "./auto-run.js";
import { buildRunPlan } from "./plan.js";
import { resolveHarnessWithFallback } from "./resolve-fallback.js";
import { initRunState, saveRunState, loadRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";

export type PromptResult = {
  ok: boolean;
  lines: string[];
};

export type ProcessPromptOptions = {
  onLine?: (line: string) => void;
  signal?: AbortSignal;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
};

function label(id: HarnessId): string {
  return HARNESS_LABEL[id] ?? id;
}

function push(lines: string[], line: string, onLine?: (line: string) => void): void {
  lines.push(line);
  onLine?.(line);
}

/** Process a natural-language prompt: plan steps and run them automatically. */
export async function processPrompt(
  cwd: string,
  prompt: string,
  options: ProcessPromptOptions = {},
): Promise<PromptResult> {
  const { onLine, signal } = options;
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, lines: ["(empty prompt)"] };

  const lines: string[] = [];
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const router = new ThinRouter(registry, sessionPolicy);
  const store = new SessionStore({ rootDir: cwd });

  let session = await store.getActive();
  if (!session || session.goal !== trimmed) {
    session = await store.start(trimmed);
    push(lines, `Session: "${trimmed}"`, onLine);
  }

  const plan = buildRunPlan(trimmed, router);
  const steps: RunStep[] = plan.steps.map((step) => ({
    ...step,
    status: "pending",
  }));

  let state: RunState = initRunState(trimmed, session.sessionId, steps);
  await saveRunState(cwd, state);

  push(lines, `Plan (${steps.length} steps):`, onLine);
  for (const [i, s] of steps.entries()) {
    push(lines, `  ${i + 1}. ${label(s.harness)} — ${s.task}`, onLine);
  }
  push(lines, "", onLine);

  for (let i = 0; i < state.steps.length; i++) {
    if (signal?.aborted) {
      push(lines, "Cancelled.", onLine);
      return { ok: false, lines };
    }

    state.currentStepIndex = i;
    const step = state.steps[i]!;
    step.status = "running";
    step.startedAt = new Date().toISOString();
    await saveRunState(cwd, state);

    push(lines, `▶ Step ${i + 1}/${state.steps.length}: ${label(step.harness)} running…`, onLine);

    const resolved = await resolveHarnessWithFallback(
      registry,
      step.harness,
      sessionPolicy.failover,
    );

    if (!resolved) {
      step.status = "failed";
      step.error = "No agent CLI found on PATH";
      step.finishedAt = new Date().toISOString();
      await saveRunState(cwd, state);
      push(lines, `  ✗ No agent CLI found (install claude or codex)`, onLine);
      return { ok: false, lines };
    }

    if (resolved.fallback) {
      push(
        lines,
        `  ↪ ${label(step.harness)} not installed — using ${label(resolved.harness)} (${resolved.binary})`,
        onLine,
      );
      step.harness = resolved.harness;
    } else {
      push(lines, `  agent: ${resolved.binary}`, onLine);
    }

    step.binary = resolved.binary;
    await store.prepareHandoff(session.sessionId, step.harness);
    const handoffPath = getHandoffPath(session.sessionId);

    const result = await runHarnessAuto({
      cwd,
      harness: step.harness,
      binary: resolved.binary,
      task: step.task,
      handoffPath,
      signal,
      onOutput: (line) => {
        onLine?.(`  │ ${line}`);
      },
    });

    if (!result.ok) {
      step.status = "failed";
      step.error = result.summary;
      step.finishedAt = new Date().toISOString();
      await saveRunState(cwd, state);
      push(lines, `  ✗ ${result.summary}`, onLine);
      if (result.output) {
        for (const row of result.output.split("\n")) {
          push(lines, `  │ ${row}`, onLine);
        }
      }
      return { ok: false, lines };
    }

    step.status = "done";
    step.finishedAt = new Date().toISOString();
    await saveRunState(cwd, state);
    push(lines, `  ✓ ${result.summary}`, onLine);

    try {
      await buildProject(cwd);
      push(lines, `  ↻ synced harness files`, onLine);
    } catch {
      // non-fatal
    }
  }

  push(lines, "", onLine);
  push(lines, "Done — all steps complete.", onLine);
  return { ok: true, lines };
}

export async function getPromptStatus(cwd: string): Promise<string[]> {
  const store = new SessionStore({ rootDir: cwd });
  const session = await store.getActive();
  if (!session) return ["No active session. Type what you want to build."];

  const state = await loadRunState(cwd, session.sessionId);
  if (!state) return [`Goal: "${session.goal}" — waiting for a prompt.`];

  return [
    `Goal: ${state.goal}`,
    ...state.steps.map((step, i) => {
      const marker = i === state.currentStepIndex ? "►" : " ";
      return `${marker} ${i + 1}. ${label(step.harness)} — ${step.status}`;
    }),
  ];
}
