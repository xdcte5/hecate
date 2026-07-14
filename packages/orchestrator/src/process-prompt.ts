import { detectInstalledBinaries, detectPiAuthProviders, discoverPiListedModels, resolveBinaryPath } from "@relay/adapters";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { executePlan } from "./execute-plan.js";
import { filterEnabledAgents, syncEnabledAgentsWithInstalled } from "./filter-agents.js";
import type { HarnessEvent } from "@relay/schema";
import { buildRunPlan } from "./plan.js";
import { initRunState, saveRunState, loadRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { formatModelLabel } from "./launch-args.js";
import { emitOrchestratorEvent, makePlanEvent } from "./events.js";
import type { SteerQueue } from "./steer-queue.js";

export type PromptResult = {
  ok: boolean;
  lines: string[];
};

export type ProcessPromptOptions = {
  onLine?: (line: string) => void;
  onEvent?: (event: HarnessEvent) => void;
  signal?: AbortSignal;
  /** Non-blocking follow-up messages while a step is running. */
  steerQueue?: SteerQueue;
  enabledAgents?: HarnessId[];
  modelOverrides?: Partial<Record<HarnessId, string>>;
  modelMode?: "auto" | "manual";
  /** Force all steps in this run onto one harness (cleared by caller after use). */
  harnessOverride?: HarnessId;
  /** Force model on all steps in this run (cleared by caller after use). */
  nextModelOverride?: string;
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

function push(
  lines: string[],
  line: string,
  onLine?: (line: string) => void,
  emit = true,
): void {
  lines.push(line);
  if (emit) onLine?.(line);
}

/** Process a natural-language prompt: plan steps and run them automatically. */
export async function processPrompt(
  cwd: string,
  prompt: string,
  options: ProcessPromptOptions = {},
): Promise<PromptResult> {
  const { onLine, onEvent, signal, steerQueue, enabledAgents, modelOverrides, harnessOverride, nextModelOverride } =
    options;
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, lines: ["(empty prompt)"] };

  const lines: string[] = [];
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);

  const installedAgents: HarnessId[] = [];
  for (const card of registry.harnesses) {
    const found = await detectInstalledBinaries(card.binaries);
    if (found.length > 0) installedAgents.push(card.id);
  }

  const effectiveEnabled =
    enabledAgents && enabledAgents.length > 0
      ? syncEnabledAgentsWithInstalled(enabledAgents, installedAgents, sessionPolicy.failover)
      : undefined;

  const failover = filterEnabledAgents(sessionPolicy.failover, effectiveEnabled);

  const piInstalled = installedAgents.includes("pi");
  const piBinary = piInstalled ? await resolveBinaryPath("pi") : null;
  const [piAuthProviders, piListedModels] = piInstalled
    ? await Promise.all([
        detectPiAuthProviders(),
        piBinary ? discoverPiListedModels(piBinary) : Promise.resolve([]),
      ])
    : [undefined, []];

  const registryForRouter =
    effectiveEnabled && effectiveEnabled.length > 0
      ? { harnesses: registry.harnesses.filter((card) => effectiveEnabled.includes(card.id)) }
      : registry;
  const router = new ThinRouter(
    registryForRouter,
    { ...sessionPolicy, failover },
    {
      piAuthProviders: piAuthProviders ? new Set([...piAuthProviders].map(String)) : undefined,
      piListedModels,
    },
  );
  const store = new SessionStore({ rootDir: cwd });

  let session = await store.getActive();
  if (!session || session.goal !== trimmed) {
    session = await store.start(trimmed);
    push(lines, `Session: "${trimmed}"`, onLine);
  }

  const plan = buildRunPlan(trimmed, router);
  const steps: RunStep[] = plan.steps.map((step) => {
    const harness = harnessOverride ?? step.harness;
    const override = modelOverrides?.[harness] ?? nextModelOverride;
    if (override) {
      return {
        ...step,
        harness,
        status: "pending" as const,
        model: override,
        modelReason: "default",
        reason: harnessOverride ? ("failover" as const) : step.reason,
      };
    }
    if (harnessOverride) {
      return { ...step, harness, status: "pending" as const, reason: "failover" as const };
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

  const planToScreen = !onEvent;
  push(lines, `Plan (${steps.length} steps, ${waves.size} wave(s)):`, onLine, planToScreen);
  for (const [wave, waveSteps] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
    const parallel = waveSteps.length > 1 ? ` [parallel]` : "";
    push(lines, `  Wave ${wave}${parallel}:`, onLine, planToScreen);
    for (const s of waveSteps) {
      const reason =
        s.reason === "ability-match" ? "ability-match" : "default failover";
      push(
        lines,
        `    • ${label(s.harness)} (${reason})${formatStepModel(s)} — ${s.task}`,
        onLine,
        planToScreen,
      );
    }
  }
  push(lines, "", onLine, planToScreen);

  emitOrchestratorEvent(
    makePlanEvent(
      steps.map((step) => ({
        id: step.id,
        task: step.task,
        harness: step.harness,
        wave: step.wave,
      })),
    ),
    { onEvent, onLine },
  );

  const result = await executePlan({
    cwd,
    state,
    store,
    registry,
    failover,
    sessionPolicy,
    modelOverrides,
    piAuthProviders: piAuthProviders ? new Set([...piAuthProviders].map(String)) : undefined,
    piListedModels,
    onLine: (line) => {
      push(lines, line, onLine);
    },
    onEvent,
    signal,
    steerQueue,
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
