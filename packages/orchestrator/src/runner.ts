import { loadRelayConfig, ThinRouter } from "@relay/registry";
import { SessionStore, getHandoffPath } from "@relay/session";
import { buildRunPlan } from "./plan.js";
import { resolveHarnessBinary } from "./resolve-binary.js";
import { formatManualLaunch, launchHarness } from "./launcher.js";
import { initRunState, loadRunState, saveRunState } from "./runner-state.js";
import type { LaunchMode, RunResult, RunState, RunStep, StepResult } from "./types.js";

export type RunOptions = {
  cwd: string;
  goal?: string;
  mode?: LaunchMode;
  interactive?: boolean;
  advance?: boolean;
  complete?: boolean;
  reset?: boolean;
  statusOnly?: boolean;
};

export { loadRunState } from "./runner-state.js";

function statusHint(step: RunStep): string {
  if (step.status === "manual") {
    return step.harness === "cursor"
      ? " — do this in Cursor chat, then: relay run --complete"
      : " — finish manually, then: relay run --complete";
  }
  if (step.status === "failed") return " — fix and: relay run --complete";
  if (step.status === "running") return " — in progress; when done: relay run --complete";
  return "";
}

export function formatRunPlan(state: RunState): string {
  const lines = state.steps.map((step, index) => {
    const marker = index === state.currentStepIndex ? "►" : " ";
    const binary = step.binary ? ` via ${step.binary}` : "";
    return `${marker} ${index + 1}. [${step.harness}${binary}] ${step.task} (${step.reason}) — ${step.status}${statusHint(step)}`;
  });
  return [`Goal: ${state.goal}`, ...lines].join("\n");
}

async function ensureSession(cwd: string, goal: string) {
  const store = new SessionStore({ rootDir: cwd });
  const active = await store.getActive();
  if (active) return { store, session: active };

  const created = await store.start(goal);
  return { store, session: created };
}

async function executeStep(
  cwd: string,
  store: SessionStore,
  sessionId: string,
  step: RunStep,
  mode: LaunchMode,
  interactive: boolean,
): Promise<StepResult> {
  const { registry } = await loadRelayConfig(cwd);
  const binary = await resolveHarnessBinary(registry, step.harness);
  step.binary = binary ?? undefined;

  const bundle = await store.prepareHandoff(sessionId, step.harness);
  const handoffPath = getHandoffPath(sessionId);

  if (mode === "dry-run") {
    return {
      step,
      launched: false,
      message: `Would route to ${step.harness}${binary ? ` (${binary})` : ""}: ${step.task}`,
    };
  }

  if (mode === "clipboard") {
    return {
      step,
      launched: false,
      message: `Handoff #${bundle.handoffSeq} prepared for ${step.harness}. ${formatManualLaunch(step.harness, handoffPath, step.task)}`,
    };
  }

  if (!binary) {
    const manual =
      step.harness === "cursor"
        ? `Cursor CLI not installed. Do this step in Cursor chat (this window), then run: relay run --complete`
        : formatManualLaunch(step.harness, handoffPath, step.task);
    return {
      step,
      launched: false,
      message: manual,
    };
  }

  const launch = await launchHarness({
    cwd,
    harness: step.harness,
    binary,
    task: step.task,
    handoffPath,
    interactive,
  });

  return {
    step,
    launched: launch.launched,
    message: launch.message,
  };
}

async function markCurrentComplete(state: RunState): Promise<string> {
  const current = state.steps[state.currentStepIndex];
  if (!current) {
    return "Run already complete.";
  }
  current.status = "done";
  current.finishedAt = new Date().toISOString();
  return `Marked step ${state.currentStepIndex + 1} done: ${current.task}`;
}

export async function runOrchestration(options: RunOptions): Promise<RunResult> {
  const {
    cwd,
    goal,
    mode = "dry-run",
    interactive = true,
    advance = false,
    complete = false,
    reset = false,
    statusOnly = false,
  } = options;

  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const router = new ThinRouter(registry, sessionPolicy);
  const { store, session } = await ensureSession(cwd, goal ?? "continue session");

  let state = await loadRunState(cwd, session.sessionId);
  let completeNote: string | undefined;

  if (reset) {
    if (!goal) {
      throw new Error("Reset requires a goal: relay run \"<goal>\" --reset");
    }
    const plan = buildRunPlan(goal, router);
    const steps: RunStep[] = plan.steps.map((step) => ({
      ...step,
      status: "pending" as const,
    }));
    state = initRunState(plan.goal, session.sessionId, steps);
    await saveRunState(cwd, state);
  } else if (goal) {
    const plan = buildRunPlan(goal, router);
    const steps: RunStep[] = plan.steps.map((step) => ({
      ...step,
      status: "pending" as const,
    }));
    state = initRunState(plan.goal, session.sessionId, steps);
    await saveRunState(cwd, state);
  } else if (complete) {
    if (!state) {
      throw new Error("No active run plan. Start with: relay run \"<goal>\"");
    }
    completeNote = await markCurrentComplete(state);
    await saveRunState(cwd, state);
  } else if (advance) {
    if (!state) {
      throw new Error("No active run plan. Start with: relay run \"<goal>\"");
    }
    const current = state.steps[state.currentStepIndex];
    if (current && current.status !== "done") {
      throw new Error(
        `Step ${state.currentStepIndex + 1} is "${current.status}". Finish it first, then: relay run --complete`,
      );
    }
    if (state.currentStepIndex < state.steps.length - 1) {
      state.currentStepIndex += 1;
    }
    await saveRunState(cwd, state);
  } else if (!state) {
    throw new Error("No active run plan. Start with: relay run \"<goal>\"");
  }

  if (!state) {
    throw new Error("Failed to initialize run state");
  }

  if (statusOnly) {
    const plan = formatRunPlan(state);
    return {
      state,
      results: [],
      message: completeNote ? `${completeNote}\n\n${plan}` : plan,
    };
  }

  if (complete && mode === "dry-run") {
    return {
      state,
      results: [],
      message: [completeNote, "", formatRunPlan(state)].filter(Boolean).join("\n"),
    };
  }

  const step = state.steps[state.currentStepIndex];
  if (!step) {
    return {
      state,
      results: [],
      message: `Run complete for goal: ${state.goal}`,
    };
  }

  if (mode === "dry-run") {
    return {
      state,
      results: [],
      message: formatRunPlan(state),
    };
  }

  if (step.status === "pending") {
    step.status = "running";
    step.startedAt = new Date().toISOString();
    await saveRunState(cwd, state);
  }

  const result = await executeStep(cwd, store, session.sessionId, step, mode, interactive);

  if (!result.launched && mode === "launch") {
    step.status = step.binary ? "failed" : "manual";
    step.error = result.message;
    if (step.status === "failed") {
      step.finishedAt = new Date().toISOString();
    }
  } else if (result.launched && mode === "launch" && interactive) {
    step.status = "running";
  }

  await saveRunState(cwd, state);

  return {
    state,
    results: [result],
    message: [formatRunPlan(state), "", result.message].join("\n"),
  };
}

export { buildRunPlan } from "./plan.js";
export { resolveHarnessBinary } from "./resolve-binary.js";
export type { RunState, RunPlan, RunResult, LaunchMode } from "./types.js";
