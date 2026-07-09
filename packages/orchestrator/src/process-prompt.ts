import { loadRelayConfig, ThinRouter } from "@relay/registry";
import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { executePlan } from "./execute-plan.js";
import { filterEnabledAgents } from "./filter-agents.js";
import { buildRunPlan } from "./plan.js";
import { initRunState, saveRunState, loadRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { formatModelLabel } from "./launch-args.js";

export type PromptResult = {
  ok: boolean;
  lines: string[];
};

export type ProcessPromptOptions = {
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  enabledAgents?: HarnessId[];
  modelOverrides?: Partial<Record<HarnessId, string>>;
  modelMode?: "auto" | "manual";
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

function formatStepModel(step: RunStep): string {
  if (!step.model) return "";
  const short = formatModelLabel(step.model);
  return ` — model: ${step.model} (${short})`;
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
  const { onLine, signal, enabledAgents, modelOverrides } = options;
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, lines: ["(empty prompt)"] };

  const lines: string[] = [];
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const failover = filterEnabledAgents(sessionPolicy.failover, enabledAgents);
  const registryForRouter =
    enabledAgents && enabledAgents.length > 0
      ? { harnesses: registry.harnesses.filter((card) => enabledAgents.includes(card.id)) }
      : registry;
  const router = new ThinRouter(registryForRouter, { ...sessionPolicy, failover });
  const store = new SessionStore({ rootDir: cwd });

  let session = await store.getActive();
  if (!session || session.goal !== trimmed) {
    session = await store.start(trimmed);
    push(lines, `Session: "${trimmed}"`, onLine);
  }

  const plan = buildRunPlan(trimmed, router);
  const steps: RunStep[] = plan.steps.map((step) => {
    const override = modelOverrides?.[step.harness];
    if (override) {
      return { ...step, status: "pending" as const, model: override, modelReason: "default" };
    }
    return { ...step, status: "pending" as const };
  });

  let state: RunState = initRunState(trimmed, session.sessionId, steps);
  await saveRunState(cwd, state);

  const waves = new Map<number, RunStep[]>();
  for (const step of steps) {
    const list = waves.get(step.wave) ?? [];
    list.push(step);
    waves.set(step.wave, list);
  }

  push(lines, `Plan (${steps.length} steps, ${waves.size} wave(s)):`, onLine);
  for (const [wave, waveSteps] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
    const parallel = waveSteps.length > 1 ? ` [parallel]` : "";
    push(lines, `  Wave ${wave}${parallel}:`, onLine);
    for (const s of waveSteps) {
      const reason =
        s.reason === "ability-match" ? "ability-match" : "default failover";
      push(lines, `    • ${label(s.harness)} (${reason})${formatStepModel(s)} — ${s.task}`, onLine);
    }
  }
  push(lines, "", onLine);

  const result = await executePlan({
    cwd,
    state,
    store,
    registry,
    failover,
    modelOverrides,
    onLine: (line) => {
      push(lines, line, onLine);
    },
    signal,
  });

  return { ok: result.ok, lines };
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
      const wave = step.wave !== undefined ? ` w${step.wave}` : "";
      return `${marker} ${i + 1}.${wave} ${label(step.harness)} — ${step.status}`;
    }),
  ];
}
