import type { HarnessId, Registry } from "@relay/schema";
import { detectSignals, scoreAbilities } from "./task-signals.js";

export type RouteModelReason = "ability-match" | "default";

export interface RouteModelResult {
  modelId?: string;
  reason: RouteModelReason;
  score: number;
  signals?: string[];
}

export function routeModel(task: string, harness: HarnessId, registry: Registry): RouteModelResult {
  const card = registry.harnesses.find((entry) => entry.id === harness);
  const models = card?.models;
  if (!models?.length) {
    return { modelId: undefined, reason: "default", score: 0 };
  }

  const signals = detectSignals(task);
  let bestModel = models[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  let matched = false;

  for (const model of models) {
    const score = scoreAbilities(model.strengths, model.weaknesses ?? [], task, signals);
    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
      if (score > 0) {
        matched = true;
      }
    }
  }

  if (!matched || bestScore <= 0) {
    return {
      modelId: models[0]!.id,
      reason: "default",
      score: 0,
      signals: [...signals],
    };
  }

  return {
    modelId: bestModel.id,
    reason: "ability-match",
    score: bestScore,
    signals: [...signals],
  };
}

export class ModelRouter {
  constructor(private readonly registry: Registry) {}

  routeModel(task: string, harness: HarnessId): RouteModelResult {
    return routeModel(task, harness, this.registry);
  }
}
