import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RoutingOutcomeSchema, type RoutingOutcome } from "@relay/schema";

export const ROUTING_STATS_RELATIVE_PATH = join(".relay", "routing-stats.jsonl");

export type SuccessRateAggregate = {
  rate: number;
  count: number;
};

export type CostAggregate = {
  median: number;
  count: number;
};

export type AggregateKey = `${string}:${string}:${string}`;
export type CostAggregateKey = `${string}:${string}`;

export function aggregateKey(
  taskType: string,
  harness: string,
  model: string,
): AggregateKey {
  return `${taskType}:${harness}:${model}`;
}

export function aggregateCostKey(taskType: string, harness: string): CostAggregateKey {
  return `${taskType}:${harness}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export async function readRoutingStats(cwd: string): Promise<RoutingOutcome[]> {
  try {
    const content = await readFile(join(cwd, ROUTING_STATS_RELATIVE_PATH), "utf8");
    const stats: RoutingOutcome[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      stats.push(RoutingOutcomeSchema.parse(JSON.parse(trimmed)));
    }

    return stats;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function aggregateSuccessRates(
  stats: RoutingOutcome[],
  minSamples: number,
): Map<AggregateKey, SuccessRateAggregate> {
  const buckets = new Map<AggregateKey, { successes: number; count: number }>();

  for (const entry of stats) {
    const model = entry.model ?? "";
    const key = aggregateKey(entry.taskType, entry.harness, model);
    const bucket = buckets.get(key) ?? { successes: 0, count: 0 };
    bucket.count += 1;
    if (entry.ok) bucket.successes += 1;
    buckets.set(key, bucket);
  }

  const aggregates = new Map<AggregateKey, SuccessRateAggregate>();
  for (const [key, bucket] of buckets) {
    aggregates.set(key, {
      rate: bucket.count > 0 ? bucket.successes / bucket.count : 0,
      count: bucket.count,
    });
  }

  // minSamples is used by getLocalScore; kept in signature for API parity.
  void minSamples;
  return aggregates;
}

/** Median costUsd per (taskType, harness) for verified successful outcomes. */
export function aggregateMedianCosts(
  stats: RoutingOutcome[],
  minSamples: number,
): Map<CostAggregateKey, CostAggregate> {
  const buckets = new Map<CostAggregateKey, number[]>();

  for (const entry of stats) {
    if (!entry.ok || !(entry.verifyOk ?? true)) continue;
    if (entry.costUsd === undefined) continue;
    const key = aggregateCostKey(entry.taskType, entry.harness);
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry.costUsd);
    buckets.set(key, bucket);
  }

  const aggregates = new Map<CostAggregateKey, CostAggregate>();
  for (const [key, costs] of buckets) {
    aggregates.set(key, {
      median: median(costs),
      count: costs.length,
    });
  }

  void minSamples;
  return aggregates;
}

export function getLocalScore(
  aggregates: Map<AggregateKey, SuccessRateAggregate>,
  taskType: string,
  harness: string,
  model: string,
  minSamples: number,
): number | null {
  const aggregate = aggregates.get(aggregateKey(taskType, harness, model));
  if (!aggregate || aggregate.count < minSamples) {
    return null;
  }
  return aggregate.rate;
}

export function getLocalCostMedian(
  aggregates: Map<CostAggregateKey, CostAggregate>,
  taskType: string,
  harness: string,
  minSamples: number,
): number | null {
  const aggregate = aggregates.get(aggregateCostKey(taskType, harness));
  if (!aggregate || aggregate.count < minSamples) {
    return null;
  }
  return aggregate.median;
}

export function getHarnessLocalStats(
  stats: RoutingOutcome[],
  taskType: string,
  harness: string,
): { count: number; rate: number } {
  const relevant = stats.filter(
    (entry) => entry.taskType === taskType && entry.harness === harness,
  );
  const count = relevant.length;
  const successes = relevant.filter((entry) => entry.ok).length;
  return { count, rate: count > 0 ? successes / count : 0 };
}

export function isHarnessExcludedByConfidence(
  stats: RoutingOutcome[],
  taskType: string,
  harness: string,
  minSamples: number,
  minSuccessRate: number,
): boolean {
  const { count, rate } = getHarnessLocalStats(stats, taskType, harness);
  return count >= minSamples && rate < minSuccessRate;
}

export type PriorDriftRow = {
  taskType: string;
  harness: string;
  samples: number;
  actualSuccess: number | null;
  priorSuccess: number;
  successDrift: number | null;
  actualCostMedian: number | null;
  samplesWithCost: number;
};

export function computePriorDrift(
  stats: RoutingOutcome[],
  priors: { task_types: Record<string, Record<string, number>> },
  getPrior: (taskType: string, harness: string) => number = (taskType, harness) => {
    const scores = priors.task_types[taskType];
    if (!scores) return 0.5;
    if (scores[harness] !== undefined) return scores[harness]!;
    return 0.5;
  },
): PriorDriftRow[] {
  const keys = new Set<string>();
  for (const entry of stats) {
    keys.add(`${entry.taskType}:${entry.harness}`);
  }

  const rows: PriorDriftRow[] = [];
  for (const key of [...keys].sort()) {
    const [taskType, harness] = key.split(":") as [string, string];
    const { count, rate } = getHarnessLocalStats(stats, taskType, harness);
    const costEntries = stats.filter(
      (entry) =>
        entry.taskType === taskType &&
        entry.harness === harness &&
        entry.ok &&
        (entry.verifyOk ?? true) &&
        entry.costUsd !== undefined,
    );
    const costs = costEntries.map((entry) => entry.costUsd!);
    const priorSuccess = getPrior(taskType, harness);

    rows.push({
      taskType,
      harness,
      samples: count,
      actualSuccess: count > 0 ? rate : null,
      priorSuccess,
      successDrift: count > 0 ? rate - priorSuccess : null,
      actualCostMedian: costs.length > 0 ? median(costs) : null,
      samplesWithCost: costs.length,
    });
  }

  return rows;
}

export function formatPriorDriftReport(rows: PriorDriftRow[]): string {
  const lines: string[] = [
    "Prior drift report (actual vs relay/routing-priors.yaml)",
    "RouterBench-style: success = quality, cost = $/run (lower is better)",
    "",
    "taskType          harness       n  actual  prior  drift   cost(n)  median$",
    "----------------  ------------  -  ------  -----  -----   -------  -------",
  ];

  for (const row of rows) {
    const actual =
      row.actualSuccess === null ? "  n/a" : row.actualSuccess.toFixed(2).padStart(6);
    const drift =
      row.successDrift === null
        ? "  n/a"
        : `${row.successDrift >= 0 ? "+" : ""}${row.successDrift.toFixed(2)}`.padStart(6);
    const cost =
      row.actualCostMedian === null ? "     n/a" : `$${row.actualCostMedian.toFixed(4)}`.padStart(8);

    lines.push(
      `${row.taskType.padEnd(16)}  ${row.harness.padEnd(12)}  ${String(row.samples).padStart(1)}  ${actual}  ${row.priorSuccess.toFixed(2).padStart(5)}  ${drift}   ${String(row.samplesWithCost).padStart(5)}  ${cost}`,
    );
  }

  if (rows.length === 0) {
    lines.push("(no stats rows — run mini-bench or relay sessions to populate routing-stats.jsonl)");
  }

  return lines.join("\n");
}
