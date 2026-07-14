import { buildProject } from "@relay/adapters";
import type { HarnessEvent, Registry, SessionPolicy } from "@relay/schema";
import type { HarnessId } from "@relay/schema";
import { routeModel } from "@relay/registry";
import { getHandoffPath, type SessionStore } from "@relay/session";
import { createDriver } from "./drivers/factory.js";
import type { HarnessRunResult } from "./drivers/types.js";
import {
  emitOrchestratorEvent,
  formatHarnessEventLine,
  makeErrorEvent,
  makeStepEndEvent,
  makeStepStartEvent,
} from "./events.js";
import { verifyWriteOutcome, snapshotWorkingTree } from "./outcome.js";
import { recordStepOutcome } from "./post-run.js";
import { groupStepsByWave } from "./plan.js";
import { suggestFailoverRetry, applyFailoverRetry } from "./replan.js";
import { resolveHarnessWithFallback } from "./resolve-fallback.js";
import { saveRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { verifyImplementWave } from "./verify.js";
import { formatModelLabel } from "./launch-args.js";
import type { SteerQueue } from "./steer-queue.js";

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
};

function label(id: HarnessId): string {
  return HARNESS_LABEL[id] ?? id;
}

function formatModelSuffix(step: RunStep): string {
  if (!step.model) return "";
  const short = formatModelLabel(step.model);
  const reason =
    step.modelReason === "ability-match"
      ? "ability-match"
      : step.modelReason === "auth-match"
        ? "auth-match"
        : "default";
  return `, model: ${short} (${reason})`;
}

function routeModelForStep(
  task: string,
  harness: HarnessId,
  registry: Registry,
  options?: { piAuthProviders?: Set<string>; piListedModels?: Array<{ provider: string; modelId: string; spec: string }> },
) {
  return routeModel(task, harness, registry, options);
}

export type ExecutePlanOptions = {
  cwd: string;
  state: RunState;
  store: SessionStore;
  registry: Registry;
  failover: HarnessId[];
  sessionPolicy?: SessionPolicy;
  modelOverrides?: Partial<Record<HarnessId, string>>;
  /** Pi providers authenticated locally — used for auth-aware model routing. */
  piAuthProviders?: Set<string>;
  /** Models from `pi --list-models`. */
  piListedModels?: Array<{ provider: string; modelId: string; spec: string }>;
  onLine?: (line: string) => void;
  onEvent?: (event: HarnessEvent) => void;
  signal?: AbortSignal;
  steerQueue?: SteerQueue;
};

export type ExecutePlanResult = {
  ok: boolean;
  state: RunState;
};

function push(
  lines: string[],
  line: string,
  onLine?: (line: string) => void,
  toScreen = true,
): void {
  lines.push(line);
  if (toScreen) onLine?.(line);
}

function persistStepResult(step: RunStep, result: HarnessRunResult, filesTouched?: string[]): void {
  step.result = {
    ok: result.ok,
    harness: step.harness,
    summary: result.summary,
    ...(step.model ? { model: step.model } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.toolCallCount !== undefined ? { toolCallCount: result.toolCallCount } : {}),
    ...(filesTouched && filesTouched.length > 0 ? { filesTouched } : {}),
  };
}

async function runSingleStep(
  options: ExecutePlanOptions,
  step: RunStep,
  stepIndex: number,
  totalSteps: number,
  lines: string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ok = await runSingleStepOnce(options, step, stepIndex, totalSteps, lines, attempt > 0);
    if (ok) return true;

    if (attempt > 0 || step.status !== "failed") {
      return false;
    }

    const retry = suggestFailoverRetry(step, options.failover);
    if (!retry) return false;

    const { onLine, onEvent } = options;
    push(lines, `  ↪ ${retry.message}`, onLine, !onEvent);
    emitOrchestratorEvent(
      { type: "retry_start", at: new Date().toISOString(), reason: retry.harness },
      { onEvent, onLine },
    );
    applyFailoverRetry(step, retry.harness);
    await saveRunState(options.cwd, options.state);
  }

  return false;
}

async function runSingleStepOnce(
  options: ExecutePlanOptions,
  step: RunStep,
  stepIndex: number,
  totalSteps: number,
  lines: string[],
  isRetry: boolean,
): Promise<boolean> {
  const { cwd, state, store, registry, failover, modelOverrides, piAuthProviders, piListedModels, onLine, onEvent, signal, steerQueue } = options;
  const emit = (event: HarnessEvent) => emitOrchestratorEvent(event, { onEvent, onLine });

  if (signal?.aborted) {
    push(lines, "Cancelled.", onLine);
    return false;
  }

  step.status = "running";
  step.startedAt = new Date().toISOString();
  await saveRunState(cwd, state);

  emit(makeStepStartEvent(step, stepIndex, totalSteps));

  const plannedHarness = step.harness;
  const plannedReason = step.reason;
  const resolved = await resolveHarnessWithFallback(registry, step.harness, failover);
  if (!resolved) {
    const summary = "No agent CLI found on PATH";
    step.status = "failed";
    step.error = summary;
    step.finishedAt = new Date().toISOString();
    persistStepResult(step, { ok: false, harness: step.harness, summary });
    await saveRunState(cwd, state);
    push(lines, `  ✗ No agent CLI found (install pi, claude, or codex)`, onLine, !onEvent);
    emit(makeStepEndEvent(step, false, summary));
    return false;
  }

  if (resolved.fallback) {
    const missing = resolved.skipped.map((id) => label(id)).join(", ");
    push(
      lines,
      `  ↪ Planned ${label(plannedHarness)} — not installed (${missing})`,
      onLine,
    );
    push(
      lines,
      `  ↪ Using ${label(resolved.harness)} (${resolved.binary})`,
      onLine,
    );
    step.harness = resolved.harness;
    if (!modelOverrides?.[step.harness]) {
      const modelRoute = routeModelForStep(step.task, step.harness, registry, {
        piAuthProviders,
        piListedModels,
      });
      step.model = modelRoute.modelId;
      step.modelReason = modelRoute.reason;
    }
  }

  if (modelOverrides?.[step.harness]) {
    step.model = modelOverrides[step.harness];
    step.modelReason = "default";
  } else if (isRetry) {
    const modelRoute = routeModelForStep(step.task, step.harness, registry, {
      piAuthProviders,
      piListedModels,
    });
    step.model = modelRoute.modelId;
    step.modelReason = modelRoute.reason;
  }

  step.binary = resolved.binary;
  const driver = createDriver(step.harness, resolved.binary);
  const via = driver.kind === "pi-rpc" ? "Pi RPC" : resolved.binary;
  const runReason = isRetry
    ? `failover retry`
    : resolved.fallback
      ? `failover (planned ${label(plannedHarness)} via ${plannedReason})`
      : plannedReason;
  push(lines, `  agent: ${via} (${runReason}${formatModelSuffix(step)})`, onLine);

  await store.prepareHandoff(state.sessionId, step.harness);
  const handoffPath = getHandoffPath(state.sessionId);

  if (driver.kind === "pi-rpc") {
    push(lines, `  mode: Pi RPC`, onLine);
  }

  const treeBefore = await snapshotWorkingTree(cwd);

  const result = await driver.run({
    cwd,
    harness: step.harness,
    binary: resolved.binary,
    task: step.task,
    handoffPath,
    model: step.model,
    signal,
    steerQueue,
    onLine: (line) => onLine?.(`  │ ${line}`),
    onEvent: (event) => {
      onEvent?.(event);
      if (options.onEvent) return;
      const line = formatHarnessEventLine(event);
      if (line) onLine?.(`  │ ${line}`);
    },
  });

  let filesTouched = result.filesTouched;

  if (!result.ok) {
    step.status = "failed";
    step.error = result.summary;
    step.finishedAt = new Date().toISOString();
    persistStepResult(step, result, filesTouched);
    await saveRunState(cwd, state);
    push(lines, `  ✗ ${result.summary}`, onLine, !onEvent);
    if (result.output) {
      for (const row of result.output.split("\n")) {
        push(lines, `  │ ${row}`, onLine);
      }
    }
    emit(makeStepEndEvent(step, false, result.summary));

    return false;
  }

  const writesFiles = step.id.startsWith("implement") || step.id === "fix";
  if (writesFiles) {
    const writeCheck = await verifyWriteOutcome(cwd, result.output, treeBefore);
    filesTouched = writeCheck.filesTouched;
    if (!writeCheck.ok) {
      step.status = "failed";
      step.error = writeCheck.message;
      step.finishedAt = new Date().toISOString();
      persistStepResult(step, { ...result, ok: false, summary: writeCheck.message }, filesTouched);
      await saveRunState(cwd, state);
      push(lines, `  ✗ ${writeCheck.message}`, onLine, !onEvent);
      emit(makeStepEndEvent(step, false, writeCheck.message));
      return false;
    }
    push(lines, `  ✓ ${writeCheck.message}`, onLine);
  }

  step.status = "done";
  step.finishedAt = new Date().toISOString();
  persistStepResult(step, result, filesTouched);
  await saveRunState(cwd, state);
    push(lines, `  ✓ ${result.summary}`, onLine, !onEvent);
  emit(makeStepEndEvent(step, true, result.summary));

  try {
    await recordStepOutcome(cwd, state.sessionId, step.harness, { ...result, filesTouched }, treeBefore);
  } catch {
    // non-fatal
  }

  try {
    await buildProject(cwd);
    push(lines, `  ↻ synced harness files`, onLine);
  } catch {
    // non-fatal
  }

  return true;
}

/** Execute plan steps wave-by-wave; agents in the same wave run in parallel. */
export async function executePlan(options: ExecutePlanOptions): Promise<ExecutePlanResult> {
  const { cwd, state, onLine, onEvent, sessionPolicy, signal } = options;
  const lines: string[] = [];
  const emit = (event: HarnessEvent) => emitOrchestratorEvent(event, { onEvent, onLine });
  const waves = groupStepsByWave(state.steps);
  let globalIndex = 0;

  for (const [wave, waveSteps] of waves) {
    if (signal?.aborted) {
      push(lines, "Cancelled.", onLine, !onEvent);
      emit(makeErrorEvent("Cancelled.", "cancelled"));
      return { ok: false, state };
    }

    if (wave > 0) {
      const verify = await verifyImplementWave(cwd, { sessionPolicy });
      if (!verify.ok) {
        for (const step of waveSteps) {
          step.status = "skipped";
          step.error = verify.message;
          step.finishedAt = new Date().toISOString();
        }
        await saveRunState(cwd, state);
        const skipMessage = `Wave ${wave} skipped — ${verify.message}`;
        push(lines, `⊘ ${skipMessage}`, onLine, !onEvent);
        push(lines, `  Run implement step first or make changes manually.`, onLine, !onEvent);
        emit(makeErrorEvent(skipMessage, "wave_skipped"));
        return { ok: false, state };
      }
      push(lines, `✓ Verification: ${verify.message}`, onLine);
    }

    state.currentStepIndex = globalIndex;
    await saveRunState(cwd, state);

    const parallel = waveSteps.length > 1;
    if (parallel) {
      push(
        lines,
        `▶ Wave ${wave}: ${waveSteps.length} agents in parallel`,
        onLine,
      );
    }

    const outcomes = await Promise.all(
      waveSteps.map((step, offset) =>
        runSingleStep(options, step, globalIndex + offset, state.steps.length, lines),
      ),
    );

    if (!outcomes.every(Boolean)) {
      return { ok: false, state };
    }

    globalIndex += waveSteps.length;
  }

  push(lines, "", onLine);
  push(lines, "Done — all steps complete.", onLine);
  return { ok: true, state };
}
