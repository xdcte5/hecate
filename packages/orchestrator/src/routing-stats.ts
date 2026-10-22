import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HarnessId, RoutingOutcome } from "@relay/schema";
import { RoutingOutcomeSchema } from "@relay/schema";
import { appendEvent } from "@relay/session";
import type { HarnessRunResult } from "./drivers/types.js";
import { classifyStepTask } from "./goal-analysis.js";
import type { RunStep } from "./types.js";

export const ROUTING_STATS_PATH = ".relay/routing-stats.jsonl";

export function resolveRoutingStatsPath(cwd: string): string {
  return join(cwd, ROUTING_STATS_PATH);
}

export { classifyStepTask };

export function buildOutcomeFromStep(
  step: RunStep,
  sessionId: string,
  result: HarnessRunResult,
  options: {
    verifyOk?: boolean;
    durationMs: number;
    failoverUsed?: boolean;
    failoverReason?: "auth" | "capability" | "verify" | "none";
    testsPassed?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): RoutingOutcome {
  return {
    ts: new Date().toISOString(),
    sessionId,
    stepId: step.id,
    taskType: classifyStepTask(step.id, step.task),
    task: step.task,
    harness: step.harness,
    model: step.model,
    ok: result.ok,
    verifyOk: options.verifyOk,
    filesChanged: result.filesTouched?.length ?? 0,
    testsPassed: options.testsPassed,
    durationMs: options.durationMs,
    failoverUsed: options.failoverUsed,
    failoverReason: options.failoverReason,
    reason: step.routeReason ?? step.reason,
    ...(options.inputTokens !== undefined ? { inputTokens: options.inputTokens } : {}),
    ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
    ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
  };
}

export async function recordRoutingOutcome(cwd: string, outcome: RoutingOutcome): Promise<void> {
  const parsed = RoutingOutcomeSchema.parse(outcome);
  const path = resolveRoutingStatsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(parsed)}\n`, "utf8");
}

export async function recordRoutingAuditEvents(
  cwd: string,
  sessionId: string,
  step: RunStep,
  result: HarnessRunResult,
  options: {
    verifyOk?: boolean;
    failoverUsed?: boolean;
    failoverReason?: "auth" | "capability" | "verify" | "none";
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): Promise<void> {
  try {
    const taskType = classifyStepTask(step.id, step.task);
    const routeReason = step.routeReason ?? step.reason;
    const base = {
      stepId: step.id,
      harness: step.harness,
      taskType,
      ...(step.model ? { model: step.model } : {}),
      ...(step.modelTier ? { modelTier: step.modelTier } : {}),
    };
    const usage = {
      ...(options.inputTokens !== undefined ? { inputTokens: options.inputTokens } : {}),
      ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
      ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
    };

    await appendEvent(cwd, sessionId, {
      event: "harness_complete",
      ...base,
      ok: result.ok,
      summary: result.summary,
      ...usage,
    });

    await appendEvent(cwd, sessionId, {
      event: "routing_outcome",
      ...base,
      ok: result.ok,
      ...(options.verifyOk !== undefined ? { verifyOk: options.verifyOk } : {}),
      ...(options.failoverUsed !== undefined ? { failoverUsed: options.failoverUsed } : {}),
      ...(options.failoverReason !== undefined ? { failoverReason: options.failoverReason } : {}),
      ...(routeReason ? { reason: routeReason } : {}),
      ...usage,
    });
  } catch {
    // non-fatal
  }
}

export async function loadRoutingOutcomes(cwd: string): Promise<RoutingOutcome[]> {
  const path = resolveRoutingStatsPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const outcomes: RoutingOutcome[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      outcomes.push(RoutingOutcomeSchema.parse(JSON.parse(trimmed)));
    } catch {
      // skip malformed lines
    }
  }
  return outcomes;
}

export type HarnessSuccessRate = {
  harness: HarnessId;
  rate: number;
  samples: number;
};

/** Success rate per harness for a task type from local routing history. */
export function computeHarnessSuccessRates(
  outcomes: RoutingOutcome[],
  taskType: string,
): HarnessSuccessRate[] {
  const buckets = new Map<HarnessId, { ok: number; total: number }>();

  for (const outcome of outcomes) {
    if (outcome.taskType !== taskType) continue;
    const bucket = buckets.get(outcome.harness) ?? { ok: 0, total: 0 };
    bucket.total += 1;
    if (outcome.ok && (outcome.verifyOk ?? true)) bucket.ok += 1;
    buckets.set(outcome.harness, bucket);
  }

  return [...buckets.entries()]
    .map(([harness, { ok, total }]) => ({
      harness,
      rate: total > 0 ? ok / total : 0,
      samples: total,
    }))
    .sort((a, b) => b.rate - a.rate || b.samples - a.samples);
}

export function pickHarnessFromLocalRates(
  rates: HarnessSuccessRate[],
  failover: HarnessId[],
  minSamples = 1,
): HarnessId | undefined {
  const eligible = rates.filter((entry) => entry.samples >= minSamples);
  if (eligible.length === 0) return undefined;

  const best = eligible[0]!;
  for (const harness of failover) {
    const match = eligible.find((entry) => entry.harness === harness);
    if (match && match.rate === best.rate) return harness;
  }
  return best.harness;
}
