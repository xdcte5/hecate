import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  RoutingPriorsSchema,
  type RoutingPriors,
} from "@relay/schema";

export const ROUTING_PRIORS_RELATIVE_PATH = join("relay", "routing-priors.yaml");

const DEFAULT_BENCHMARK_PRIOR = 0.5;

export const EMPTY_ROUTING_PRIORS: RoutingPriors = {
  version: "0",
  task_types: {},
};

function targetKey(harness: string, modelId?: string): string {
  return modelId ? `${harness}/${modelId}` : harness;
}

function matchesTarget(target: string, harness: string, modelId?: string): boolean {
  if (target === harness) return true;
  if (modelId && target === targetKey(harness, modelId)) return true;
  if (modelId && target === modelId) return true;
  return false;
}

export async function loadRoutingPriors(cwd: string): Promise<RoutingPriors> {
  try {
    const content = await readFile(join(cwd, ROUTING_PRIORS_RELATIVE_PATH), "utf8");
    return RoutingPriorsSchema.parse(parseYaml(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_ROUTING_PRIORS;
    }
    throw error;
  }
}

export function getBenchmarkPrior(
  priors: RoutingPriors,
  taskType: string,
  harness: string,
  modelId?: string,
): number {
  const scores = priors.task_types[taskType];
  if (!scores) return DEFAULT_BENCHMARK_PRIOR;

  if (modelId) {
    const modelKey = targetKey(harness, modelId);
    if (scores[modelKey] !== undefined) return scores[modelKey]!;
    if (scores[modelId] !== undefined) return scores[modelId]!;
  }

  if (scores[harness] !== undefined) return scores[harness]!;

  return DEFAULT_BENCHMARK_PRIOR;
}

/** Sum of signal-based boosts for a harness/model target (not clamped). */
export function applySignalAdjustments(
  priors: RoutingPriors,
  signals: Set<string>,
  harness: string,
  modelId?: string,
): number {
  let boost = 0;

  for (const adjustment of priors.signal_adjustments ?? []) {
    if (!signals.has(adjustment.signal)) continue;
    if (matchesTarget(adjustment.target, harness, modelId)) {
      boost += adjustment.adjustment;
    }
  }

  return boost;
}

export function clampPrior(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
