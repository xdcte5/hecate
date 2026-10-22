import { buildProject } from "@relay/adapters";
import {
  resolveSessionPolicyVerification,
  type HarnessEvent,
  type Registry,
  type SessionPolicy,
  type StepRoutingRule,
} from "@relay/schema";
import type { HarnessId } from "@relay/schema";
import { isModelProviderAvailable, routeModel, type ThinRouter } from "@relay/registry";
import { getHandoffPath, handoffTierForTaskType, type SessionStore } from "@relay/session";
import { appendEvent } from "@relay/session";
import { createDriver } from "./drivers/factory.js";
import type { HarnessRunResult } from "./drivers/types.js";
import {
  emitOrchestratorEvent,
  formatHarnessEventLine,
  makeErrorEvent,
  makeStepEndEvent,
  makeStepStartEvent,
} from "./events.js";
import { classifyStepTask, isTrivialGoal } from "./goal-analysis.js";
import type { HarnessEligibilityContext } from "./harness-eligibility.js";
import { isHarnessRunnable } from "./harness-eligibility.js";
import { verifyWriteOutcome, snapshotWorkingTree } from "./outcome.js";
import { recordStepOutcome } from "./post-run.js";
import { groupStepsByWave } from "./plan.js";
import {
  suggestFailoverRetry,
  applyFailoverRetry,
  suggestVerifyRetry,
  applyVerifyRetry,
} from "./replan.js";
import { resolveHarnessBinary } from "./resolve-binary.js";
import {
  buildOutcomeFromStep,
  recordRoutingAuditEvents,
  recordRoutingOutcome,
} from "./routing-stats.js";
import { saveRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { verifyImplementWave } from "./verify.js";
import { formatModelLabel } from "./launch-args.js";
import type { SteerQueue } from "./steer-queue.js";
import { runVerifiers } from "./verifiers/index.js";
import type { GateVerdict } from "./verifiers/types.js";
import { runVerifierGraph } from "./graph/index.js";
import type { GraphNodeResult } from "./graph/index.js";

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
  options?: {
    piAuthProviders?: Set<string>;
    piListedModels?: Array<{ provider: string; modelId: string; spec: string }>;
    taskType?: string;
    modelTier?: StepRoutingRule["model_tier"];
    router?: ThinRouter;
  },
) {
  if (options?.router && options.taskType) {
    return options.router.routeModel(task, harness, options.taskType, options.modelTier);
  }
  return routeModel(task, harness, registry, {
    piAuthProviders: options?.piAuthProviders,
    piListedModels: options?.piListedModels,
    modelTier: options?.modelTier,
  });
}

function stepDurationMs(step: RunStep): number {
  const started = step.startedAt ? Date.parse(step.startedAt) : Date.now();
  const finished = step.finishedAt ? Date.parse(step.finishedAt) : Date.now();
  return Math.max(0, finished - started);
}

async function persistRoutingOutcome(
  options: ExecutePlanOptions,
  step: RunStep,
  result: HarnessRunResult,
  meta: {
    verifyOk?: boolean;
    failoverUsed?: boolean;
    failoverReason?: "auth" | "capability" | "verify" | "none";
    testsPassed?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): Promise<void> {
  const usage = {
    inputTokens: meta.inputTokens ?? result.inputTokens,
    outputTokens: meta.outputTokens ?? result.outputTokens,
    costUsd: meta.costUsd ?? result.costUsd,
  };

  try {
    await recordRoutingOutcome(
      options.cwd,
      buildOutcomeFromStep(step, options.state.sessionId, result, {
        verifyOk: meta.verifyOk,
        durationMs: stepDurationMs(step),
        failoverUsed: meta.failoverUsed,
        failoverReason: meta.failoverReason,
        testsPassed: meta.testsPassed,
        ...usage,
      }),
    );
  } catch {
    // non-fatal
  }

  try {
    await recordRoutingAuditEvents(options.cwd, options.state.sessionId, step, result, {
      verifyOk: meta.verifyOk,
      failoverUsed: meta.failoverUsed,
      failoverReason: meta.failoverReason,
      ...usage,
    });
  } catch {
    // non-fatal
  }
}

export type ExecutePlanOptions = {
  cwd: string;
  state: RunState;
  store: SessionStore;
  registry: Registry;
  failover: HarnessId[];
  /** Harnesses with an executable CLI on PATH. */
  installedAgents?: HarnessId[];
  /** Auth/install preflight context for harness eligibility. */
  eligibilityCtx?: HarnessEligibilityContext;
  sessionPolicy?: SessionPolicy;
  modelOverrides?: Partial<Record<HarnessId, string>>;
  /** Pi providers authenticated locally — used for auth-aware model routing. */
  piAuthProviders?: Set<string>;
  /** Models from `pi --list-models`. */
  piListedModels?: Array<{ provider: string; modelId: string; spec: string }>;
  /** Blended router used for task-type-aware model routing on failover. */
  router?: ThinRouter;
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
  let attempt = 0;
  let failoverRetried = false;

  while (true) {
    const ok = await runSingleStepOnce(options, step, stepIndex, totalSteps, lines, attempt > 0);
    if (ok) return true;

    if (step.status !== "failed") {
      return false;
    }

    if (step.lastVerifyVerdict && !step.lastVerifyVerdict.ok) {
      if ((step.error ?? "").startsWith("Repeated verifier failure")) {
        return false;
      }
      const verification = options.sessionPolicy
        ? resolveSessionPolicyVerification(options.sessionPolicy)
        : { maxStepRetries: 3 };
      const retry = suggestVerifyRetry(step, step.lastVerifyVerdict, {
        maxRetries: verification.maxStepRetries,
      });
      if (!retry) return false;

      const { onLine, onEvent } = options;
      push(
        lines,
        `  ↪ Verifier blocked step "${step.id}"; retrying (${retry.retryNumber}/${retry.maxRetries})`,
        onLine,
        !onEvent,
      );
      emitOrchestratorEvent(
        { type: "retry_start", at: new Date().toISOString(), reason: "verify" },
        { onEvent, onLine },
      );
      applyVerifyRetry(step, retry.feedback, retry.retryNumber);
      await saveRunState(options.cwd, options.state);
      attempt += 1;
      continue;
    }

    if (failoverRetried) return false;

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
    failoverRetried = true;
    attempt += 1;
  }
}

function buildEligibilityCtx(options: ExecutePlanOptions): HarnessEligibilityContext {
  return (
    options.eligibilityCtx ?? {
      installed: options.installedAgents ?? [],
      piAuthProviders: options.piAuthProviders,
      piListedModels: options.piListedModels,
    }
  );
}

type ResolvedStepHarness = {
  harness: HarnessId;
  binary: string;
  fallback: boolean;
  skipped: HarnessId[];
  failoverReason?: "auth" | "capability" | "verify" | "none";
};

function makeVerifyOutcomeEvent(
  step: RunStep,
  verdict: GateVerdict,
  maxRetries: number,
): HarnessEvent {
  return {
    type: "verify_outcome",
    at: new Date().toISOString(),
    stepId: step.id,
    harness: step.harness,
    ok: verdict.ok,
    recommendation: verdict.recommendation,
    confidence: verdict.confidence,
    evidence: verdict.evidence,
    verifierId: verdict.verifierId,
    verifyRetries: step.verifyRetries ?? 0,
    maxRetries,
    failoverReason: verdict.ok ? "none" : "verify",
    ...(verdict.ok ? {} : { failedComponent: "tool_implementation" }),
    durationMs: Math.round(verdict.durationMs),
  };
}

function makeGraphNodeEvent(step: RunStep, result: GraphNodeResult): HarnessEvent {
  return {
    type: "graph_node",
    at: new Date().toISOString(),
    stepId: step.id,
    nodeId: result.nodeId,
    nodeType: result.verifier?.verifierId ?? result.nodeType,
    ok: result.ok,
    durationMs: Math.round(result.durationMs),
    ...(result.evidence ? { evidence: result.evidence } : {}),
  };
}

function recordVerifierFailureEvidence(step: RunStep, verdict: GateVerdict): boolean {
  if (verdict.ok) {
    step.verifyFailureEvidence = undefined;
    return false;
  }

  const evidence = verdict.evidence.trim();
  const history = step.verifyFailureEvidence ?? [];
  step.verifyFailureEvidence = [...history, evidence];
  return history.at(-1) === evidence;
}

async function persistHarnessEvent(
  cwd: string,
  sessionId: string,
  event: HarnessEvent,
): Promise<void> {
  try {
    const { type, at: _at, ...rest } = event;
    await appendEvent(cwd, sessionId, { event: type, ...rest });
  } catch {
    // non-fatal
  }
}

async function resolveRunnableStepHarness(
  options: ExecutePlanOptions,
  step: RunStep,
  plannedHarness: HarnessId,
  isRetry: boolean,
): Promise<ResolvedStepHarness | null> {
  const { registry, failover, modelOverrides, piAuthProviders, piListedModels, router } = options;
  const eligibility = buildEligibilityCtx(options);
  const taskType = classifyStepTask(step.id, step.task);
  const order = [plannedHarness, ...failover.filter((h) => h !== plannedHarness)];
  const skipped: HarnessId[] = [];
  let authSkipped = false;

  for (const harness of order) {
    if (!isHarnessRunnable(harness, eligibility)) {
      skipped.push(harness);
      if (harness === "pi") authSkipped = true;
      continue;
    }

    const binary = await resolveHarnessBinary(registry, harness);
    if (!binary) {
      skipped.push(harness);
      continue;
    }

    let model = modelOverrides?.[harness];
    let modelReason = step.modelReason ?? "default";
    if (!model) {
      const modelRoute = routeModelForStep(step.task, harness, registry, {
        piAuthProviders,
        piListedModels,
        taskType,
        modelTier: step.modelTier,
        router,
      });
      model = modelRoute.modelId;
      modelReason = modelRoute.reason;
    } else {
      modelReason = "default";
    }

    if (
      harness === "pi" &&
      model &&
      piAuthProviders &&
      piAuthProviders.size > 0 &&
      !isModelProviderAvailable(model, piAuthProviders)
    ) {
      skipped.push(harness);
      authSkipped = true;
      continue;
    }

    step.harness = harness;
    step.model = model;
    step.modelReason = modelReason;

    return {
      harness,
      binary,
      fallback: harness !== plannedHarness,
      skipped,
      failoverReason:
        harness !== plannedHarness ? (authSkipped ? "auth" : "none") : authSkipped ? "auth" : "none",
    };
  }

  return null;
}

async function runSingleStepOnce(
  options: ExecutePlanOptions,
  step: RunStep,
  stepIndex: number,
  totalSteps: number,
  lines: string[],
  isRetry: boolean,
): Promise<boolean> {
  const { cwd, state, store, onLine, onEvent, signal, steerQueue } = options;
  const emit = (event: HarnessEvent) => emitOrchestratorEvent(event, { onEvent, onLine });
  const taskType = classifyStepTask(step.id, step.task);

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
  const resolved = await resolveRunnableStepHarness(options, step, plannedHarness, isRetry);
  if (!resolved) {
    const summary = "No runnable agent found (auth or install preflight failed)";
    step.status = "failed";
    step.error = summary;
    step.finishedAt = new Date().toISOString();
    persistStepResult(step, { ok: false, harness: step.harness, summary });
    await saveRunState(cwd, state);
    push(lines, `  ✗ ${summary}`, onLine, !onEvent);
    emit(makeStepEndEvent(step, false, summary));
    await persistRoutingOutcome(options, step, { ok: false, harness: step.harness, summary }, {
      failoverUsed: false,
      failoverReason: "auth",
    });
    return false;
  }

  if (resolved.skipped.length > 0) {
    const skippedLabels = resolved.skipped.map((id) => label(id)).join(", ");
    push(lines, `  ↪ Skipped non-runnable harnesses: ${skippedLabels}`, onLine);
  }

  if (resolved.fallback) {
    const missing = resolved.skipped.map((id) => label(id)).join(", ");
    push(
      lines,
      `  ↪ Planned ${label(plannedHarness)} — not runnable (${missing})`,
      onLine,
    );
    push(
      lines,
      `  ↪ Using ${label(resolved.harness)} (${resolved.binary})`,
      onLine,
    );
  }

  step.binary = resolved.binary;
  const driver = createDriver(resolved.harness, resolved.binary);
  const via = driver.kind === "pi-rpc" ? "Pi RPC" : resolved.binary;
  const runReason = isRetry
    ? `failover retry`
    : resolved.fallback
      ? `failover (planned ${label(plannedHarness)} via ${plannedReason})`
      : plannedReason;
  push(lines, `  agent: ${via} (${runReason}${formatModelSuffix(step)})`, onLine);

  const trivialFastPath = totalSteps === 1 && step.id === "implement" && isTrivialGoal(state.goal);
  if (!trivialFastPath) {
    await store.prepareHandoff(state.sessionId, step.harness, {
      tier: handoffTierForTaskType(taskType),
    });
  }
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
    await persistRoutingOutcome(options, step, result, {
      failoverUsed: Boolean(resolved.fallback || isRetry),
      failoverReason: resolved.failoverReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });

    return false;
  }

  const writesFiles = step.id.startsWith("implement") || step.id === "fix";
  const hasStepVerifiers = (step.verify?.length ?? 0) > 0;
  if (writesFiles && !hasStepVerifiers) {
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
      await persistRoutingOutcome(options, step, { ...result, ok: false, summary: writeCheck.message }, {
        verifyOk: false,
        failoverUsed: Boolean(resolved.fallback || isRetry),
        failoverReason: resolved.failoverReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });
      return false;
    }
    push(lines, `  ✓ ${writeCheck.message}`, onLine);
  }

  const verification = options.sessionPolicy
    ? resolveSessionPolicyVerification(options.sessionPolicy)
    : { maxStepRetries: 3 };
  let verifierVerdict: GateVerdict;
  if (process.env.RELAY_GRAPH === "1" && hasStepVerifiers) {
    const graphEvents: HarnessEvent[] = [];
    const graphResult = await runVerifierGraph(step, cwd, {
      sessionId: state.sessionId,
      sessionPolicy: options.sessionPolicy,
      onNodeResult: (nodeResult) => {
        const event = makeGraphNodeEvent(step, nodeResult);
        graphEvents.push(event);
        emit(event);
      },
    });
    for (const event of graphEvents) {
      await persistHarnessEvent(cwd, state.sessionId, event);
    }
    verifierVerdict = graphResult.verdict;
  } else {
    verifierVerdict = await runVerifiers(step, cwd, {
      sessionId: state.sessionId,
      sessionPolicy: options.sessionPolicy,
    });
  }
  step.lastVerifyVerdict = verifierVerdict;
  const repeatedVerifierFailure = recordVerifierFailureEvidence(step, verifierVerdict);
  const verifyEvent = makeVerifyOutcomeEvent(step, verifierVerdict, verification.maxStepRetries);
  emit(verifyEvent);
  await persistHarnessEvent(cwd, state.sessionId, verifyEvent);
  if (!verifierVerdict.ok) {
    const summary = repeatedVerifierFailure
      ? `Repeated verifier failure: ${verifierVerdict.evidence}`
      : `Verification blocked step: ${verifierVerdict.evidence}`;
    step.status = "failed";
    step.error = summary;
    step.finishedAt = new Date().toISOString();
    persistStepResult(step, { ...result, ok: false, summary }, filesTouched);
    await saveRunState(cwd, state);
    push(lines, `  ✗ ${summary}`, onLine, !onEvent);
    emit(makeStepEndEvent(step, false, summary));
    await persistRoutingOutcome(options, step, { ...result, ok: false, summary }, {
      verifyOk: false,
      failoverUsed: Boolean(resolved.fallback || isRetry),
      failoverReason: "verify",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });
    return false;
  }

  step.status = "done";
  step.finishedAt = new Date().toISOString();
  persistStepResult(step, result, filesTouched);
  await saveRunState(cwd, state);
    push(lines, `  ✓ ${result.summary}`, onLine, !onEvent);
  emit(makeStepEndEvent(step, true, result.summary));
  await persistRoutingOutcome(options, step, result, {
    verifyOk: writesFiles ? true : undefined,
    failoverUsed: Boolean(resolved.fallback || isRetry),
    failoverReason: resolved.failoverReason,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });

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
