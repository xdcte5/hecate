import { buildProject } from "@relay/adapters";
import type { Registry } from "@relay/schema";
import type { HarnessId } from "@relay/schema";
import { routeModel } from "@relay/registry";
import { getHandoffPath, type SessionStore } from "@relay/session";
import { createDriver } from "./drivers/factory.js";
import { verifyWriteOutcome, snapshotWorkingTree } from "./outcome.js";
import { recordStepOutcome } from "./post-run.js";
import { groupStepsByWave } from "./plan.js";
import { resolveHarnessWithFallback } from "./resolve-fallback.js";
import { saveRunState } from "./runner-state.js";
import type { RunState, RunStep } from "./types.js";
import { verifyImplementWave, runVerifyCommand } from "./verify.js";
import { formatModelLabel } from "./launch-args.js";

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving
 * result order. `limit >= items.length` degrades to a plain `Promise.all`.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit >= items.length) {
    return Promise.all(items.map((item, index) => fn(item, index)));
  }
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "gemini-cli": "Gemini",
};

function label(id: HarnessId): string {
  return HARNESS_LABEL[id] ?? id;
}

function formatModelSuffix(step: RunStep): string {
  if (!step.model) return "";
  const short = formatModelLabel(step.model);
  const reason = step.modelReason === "ability-match" ? "ability-match" : "default";
  return `, model: ${short} (${reason})`;
}

export type ExecutePlanOptions = {
  cwd: string;
  state: RunState;
  store: SessionStore;
  registry: Registry;
  failover: HarnessId[];
  modelOverrides?: Partial<Record<HarnessId, string>>;
  /** Max agents to run at once within a wave (default: whole wave in parallel). */
  maxConcurrency?: number;
  /** Verification gate between waves (default: enabled, file-change check). */
  verify?: { enabled?: boolean; command?: string };
  onLine?: (line: string) => void;
  signal?: AbortSignal;
};

export type ExecutePlanResult = {
  ok: boolean;
  state: RunState;
};

function push(lines: string[], line: string, onLine?: (line: string) => void): void {
  lines.push(line);
  onLine?.(line);
}

async function runSingleStep(
  options: ExecutePlanOptions,
  step: RunStep,
  stepIndex: number,
  totalSteps: number,
  lines: string[],
): Promise<boolean> {
  const { cwd, state, store, registry, failover, modelOverrides, onLine, signal } = options;

  if (signal?.aborted) {
    push(lines, "Cancelled.", onLine);
    return false;
  }

  step.status = "running";
  step.startedAt = new Date().toISOString();
  await saveRunState(cwd, state);

  push(lines, `▶ Step ${stepIndex + 1}/${totalSteps}: ${label(step.harness)} running…`, onLine);

  const plannedHarness = step.harness;
  const plannedReason = step.reason;
  const resolved = await resolveHarnessWithFallback(registry, step.harness, failover);
  if (!resolved) {
    step.status = "failed";
    step.error = "No agent CLI found on PATH";
    step.finishedAt = new Date().toISOString();
    await saveRunState(cwd, state);
    push(lines, `  ✗ No agent CLI found (install pi, claude, or codex)`, onLine);
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
      const modelRoute = routeModel(step.task, step.harness, registry);
      step.model = modelRoute.modelId;
      step.modelReason = modelRoute.reason;
    }
  }

  if (modelOverrides?.[step.harness]) {
    step.model = modelOverrides[step.harness];
    step.modelReason = "default";
  }

  step.binary = resolved.binary;
  const driver = createDriver(step.harness, resolved.binary);
  const via = driver.kind === "pi-rpc" ? "Pi RPC" : resolved.binary;
  const runReason = resolved.fallback
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
    onEvent: (line) => onLine?.(`  │ ${line}`),
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
    return false;
  }

  const writesFiles = step.id.startsWith("implement") || step.id === "fix";
  if (writesFiles) {
    const writeCheck = await verifyWriteOutcome(cwd, result.output, treeBefore);
    if (!writeCheck.ok) {
      step.status = "failed";
      step.error = writeCheck.message;
      step.finishedAt = new Date().toISOString();
      await saveRunState(cwd, state);
      push(lines, `  ✗ ${writeCheck.message}`, onLine);
      return false;
    }
    push(lines, `  ✓ ${writeCheck.message}`, onLine);
  }

  step.status = "done";
  step.finishedAt = new Date().toISOString();
  await saveRunState(cwd, state);
  push(lines, `  ✓ ${result.summary}`, onLine);

  try {
    await recordStepOutcome(cwd, state.sessionId, step.harness, result);
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
  const { cwd, state, onLine, signal } = options;
  const lines: string[] = [];
  const waves = groupStepsByWave(state.steps);
  let globalIndex = 0;

  for (const [wave, waveSteps] of waves) {
    if (signal?.aborted) {
      push(lines, "Cancelled.", onLine);
      return { ok: false, state };
    }

    const verifyEnabled = options.verify?.enabled !== false;
    if (wave > 0 && verifyEnabled) {
      const verify = options.verify?.command
        ? await runVerifyCommand(cwd, options.verify.command)
        : await verifyImplementWave(cwd);
      if (!verify.ok) {
        for (const step of waveSteps) {
          step.status = "skipped";
          step.error = verify.message;
          step.finishedAt = new Date().toISOString();
        }
        await saveRunState(cwd, state);
        push(lines, `⊘ Wave ${wave} skipped — ${verify.message}`, onLine);
        push(lines, `  Run implement step first or make changes manually.`, onLine);
        return { ok: false, state };
      }
      push(lines, `✓ Verification: ${verify.message}`, onLine);
    }

    state.currentStepIndex = globalIndex;
    await saveRunState(cwd, state);

    const limit = options.maxConcurrency && options.maxConcurrency > 0
      ? options.maxConcurrency
      : waveSteps.length;
    const parallel = waveSteps.length > 1;
    if (parallel) {
      const limitNote = limit < waveSteps.length ? ` (max ${limit} at once)` : "";
      push(
        lines,
        `▶ Wave ${wave}: ${waveSteps.length} agents in parallel${limitNote}`,
        onLine,
      );
    }

    const outcomes = await runWithConcurrency(waveSteps, limit, (step, offset) =>
      runSingleStep(options, step, globalIndex + offset, state.steps.length, lines),
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
