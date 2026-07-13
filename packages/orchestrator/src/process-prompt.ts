import { loadRelayConfig, ThinRouter, assignStep, assignModel, selectPrimaryPlanner } from "@relay/registry";
import type { HarnessCard, HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { executePlan } from "./execute-plan.js";
import { filterEnabledAgents } from "./filter-agents.js";
import { buildRunPlan } from "./plan.js";
import { initRunState, saveRunState, loadRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { formatModelLabel } from "./launch-args.js";
import { resolveHarnessBinary } from "./resolve-binary.js";
import { classifyIntent } from "./intent.js";
import { generateLlmPlan, type PlannedTask } from "./llm-planner.js";
import { runRawPrompt } from "./run-raw.js";
import { runConversation } from "./conversation.js";

export type PromptResult = {
  ok: boolean;
  lines: string[];
};

export type ProcessPromptOptions = {
  onLine?: (line: string) => void;
  /** The user-facing answer/result (or error), separate from the verbose trace. */
  onResponse?: (text: string, kind: "answer" | "error") => void;
  signal?: AbortSignal;
  enabledAgents?: HarnessId[];
  modelOverrides?: Partial<Record<HarnessId, string>>;
  modelMode?: "auto" | "manual";
  /** Deep-customization knobs from `relay/orchestrator.yaml`. */
  maxConcurrency?: number;
  verify?: { enabled?: boolean; command?: string };
  routingOverrides?: Record<string, HarnessId>;
  subSessions?: boolean;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "antigravity": "Antigravity",
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

function reasonLabel(reason: RunStep["reason"]): string {
  if (reason === "capability-match") return "capability-match";
  if (reason === "ability-match") return "ability-match";
  return "default failover";
}

/** Which harnesses are actually installed among the (optionally enabled) candidates. */
async function detectAvailable(registry: Registry, enabled?: HarnessId[]): Promise<HarnessId[]> {
  const allow = enabled && enabled.length > 0 ? new Set(enabled) : null;
  const ids = registry.harnesses.map((h) => h.id).filter((id) => !allow || allow.has(id));
  const checks = await Promise.all(
    ids.map(async (id) => ({ id, binary: await resolveHarnessBinary(registry, id) })),
  );
  return checks.filter((c) => c.binary).map((c) => c.id);
}

/** Map a deterministic step id to the capabilities its work needs. */
function deriveCapabilities(stepId: string): string[] {
  if (stepId.startsWith("implement-frontend")) return ["implementation", "frontend"];
  if (stepId.startsWith("implement-backend")) return ["implementation", "backend"];
  if (stepId.startsWith("implement")) return ["implementation"];
  if (stepId.startsWith("test")) return ["testing"];
  if (stepId.startsWith("review")) return ["review"];
  if (stepId.startsWith("fix")) return ["debugging"];
  return ["implementation"];
}

/** Fallback decomposition when no planner model is available or its output is unusable. */
function deterministicTasks(goal: string, router: ThinRouter): PlannedTask[] {
  return buildRunPlan(goal, router).steps.map((step) => ({
    id: step.id,
    task: step.task,
    requiredCapabilities: deriveCapabilities(step.id),
    wave: step.wave,
  }));
}

/** Assign a planned task to a harness + model via the capability-aware router. */
function assignToStep(
  task: PlannedTask,
  registry: Registry,
  policy: SessionPolicy,
  enabled: HarnessId[] | undefined,
  modelOverrides: Partial<Record<HarnessId, string>> | undefined,
): RunStep {
  const a = assignStep({
    task: task.task,
    requiredCapabilities: task.requiredCapabilities,
    registry,
    policy,
    enabled,
  });
  // Only an explicit override is forced onto the CLI; auto mode lets each
  // harness use its own configured default model (respects its provider/auth).
  const override = modelOverrides?.[a.harness];
  return {
    id: task.id,
    task: task.task,
    harness: a.harness,
    reason: a.harnessReason,
    model: override,
    modelReason: "default",
    wave: task.wave,
    status: "pending",
  };
}

/**
 * Apply `relay/orchestrator.yaml` routing overrides (step-kind → harness).
 * Explicit config wins over capability routing; the model is re-picked for the
 * forced harness. A key matches a step whose id equals it or starts with `<key>-`.
 */
function applyStepOverrides(
  steps: RunStep[],
  overrides: Record<string, HarnessId> | undefined,
  registry: Registry,
  modelOverrides: Partial<Record<HarnessId, string>> | undefined,
): RunStep[] {
  if (!overrides || Object.keys(overrides).length === 0) return steps;
  return steps.map((step) => {
    for (const [kind, harness] of Object.entries(overrides)) {
      if (step.id === kind || step.id.startsWith(`${kind}-`)) {
        const card = registry.harnesses.find((c) => c.id === harness) as HarnessCard | undefined;
        const model = card ? assignModel(step.task, deriveCapabilities(step.id), card) : undefined;
        const override = modelOverrides?.[harness];
        return {
          ...step,
          harness,
          reason: "ability-match" as const,
          model: override ?? model?.id,
          modelReason: override ? "default" : (model?.reason ?? "default"),
        };
      }
    }
    return step;
  });
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
  const registryForRouter: Registry =
    enabledAgents && enabledAgents.length > 0
      ? { harnesses: registry.harnesses.filter((card) => enabledAgents.includes(card.id)) }
      : registry;
  const policyForRouter: SessionPolicy = { ...sessionPolicy, failover };
  const router = new ThinRouter(registryForRouter, policyForRouter);
  const store = new SessionStore({ rootDir: cwd });

  const available = await detectAvailable(registry, enabledAgents);

  // Chit-chat / explanations are answered by the best conversational model —
  // no planning, no agent delegation.
  const intent = classifyIntent(trimmed);
  if (intent.intent === "chat") {
    push(lines, `Intent: chat (${intent.reason})`, onLine);
    const conv = await runConversation({ cwd, registry, prompt: trimmed, available, signal });
    if (conv.ok && conv.text) {
      push(lines, `answer via ${label(conv.harness!)}${conv.model ? ` · ${conv.model}` : ""}`, onLine);
      for (const row of conv.text.split("\n")) lines.push(row);
      options.onResponse?.(conv.text, "answer");
      return { ok: true, lines };
    }
    const why = `Couldn't answer (${conv.reason ?? "no conversational agent available"}).`;
    push(lines, why, onLine);
    options.onResponse?.(why, "error");
    return { ok: false, lines };
  }

  let session = await store.getActive();
  if (!session || session.goal !== trimmed) {
    session = await store.start(trimmed);
    push(lines, `Session: "${trimmed}"`, onLine);
  }

  // "Spy on" planning: ask the best available planner for a structured JSON plan,
  // then assign each step by required capability. Fall back to heuristics offline.
  const planner = selectPrimaryPlanner(registry, available);
  const runPlanner = planner
    ? (planPrompt: string) =>
        runRawPrompt({
          cwd,
          harness: planner.harness,
          registry,
          prompt: planPrompt,
          model: planner.model,
          signal,
          timeoutMs: 60_000,
        })
    : undefined;

  const llmTasks = await generateLlmPlan(trimmed, runPlanner);
  const tasks = llmTasks && llmTasks.length > 0 ? llmTasks : deterministicTasks(trimmed, router);
  push(
    lines,
    llmTasks && llmTasks.length > 0
      ? `Planner: ${label(planner!.harness)} — structured plan (${tasks.length} steps)`
      : `Planner: heuristic decomposition (${tasks.length} steps)`,
    onLine,
  );

  let steps: RunStep[] = tasks.map((task) =>
    assignToStep(task, registryForRouter, policyForRouter, enabledAgents, modelOverrides),
  );
  steps = applyStepOverrides(steps, options.routingOverrides, registryForRouter, modelOverrides);

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
      push(
        lines,
        `    • ${label(s.harness)} (${reasonLabel(s.reason)})${formatStepModel(s)} — ${s.task}`,
        onLine,
      );
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
    maxConcurrency: options.maxConcurrency,
    verify: options.verify,
    subSessions: options.subSessions,
    onLine: (line) => {
      push(lines, line, onLine);
    },
    onResponse: options.onResponse,
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
