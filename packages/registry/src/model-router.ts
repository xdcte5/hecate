import type { HarnessId, Registry } from "@relay/schema";
import { isModelProviderAvailable } from "./model-provider.js";
import { detectSignals, scoreAbilities } from "./task-signals.js";

export type PiListedModelRef = {
  provider: string;
  modelId: string;
  spec: string;
};

export type RouteModelReason = "ability-match" | "default" | "auth-match";
export type ModelTier = "capable";

export interface RouteModelResult {
  modelId?: string;
  reason: RouteModelReason;
  score: number;
  signals?: string[];
}

export type RouteModelOptions = {
  /** Pi OAuth / API-key providers available locally — filters models before routing. */
  piAuthProviders?: Set<string>;
  /** Models from `pi --list-models` — preferred over static registry for Pi. */
  piListedModels?: PiListedModelRef[];
  /** Harnesses installed locally — limits blended/heuristic routing candidates. */
  installedHarnesses?: HarnessId[];
  /** Prefer stronger models (registry order: last entry) over economical defaults. */
  modelTier?: ModelTier;
};

function isEconomicalModelId(modelId: string): boolean {
  return /\bmini\b/i.test(modelId);
}

export function modelsForTier<T extends { id: string }>(models: T[], tier?: ModelTier): T[] {
  if (tier !== "capable") return models;
  const capable = models.filter((model) => !isEconomicalModelId(model.id));
  return capable.length > 0 ? capable : models;
}

export function pickDefaultModelByTier<T extends { id: string }>(models: T[], tier?: ModelTier): T {
  const pool = modelsForTier(models, tier);
  return tier === "capable" ? pool[pool.length - 1]! : pool[0]!;
}

export function shouldDeferToHarnessDefaultModel(harness: HarnessId): boolean {
  return harness === "codex";
}

function routePiFromListedModels(
  task: string,
  listed: PiListedModelRef[],
  piAuthProviders?: Set<string>,
  modelTier?: ModelTier,
): RouteModelResult | null {
  let candidates = listed;
  if (piAuthProviders && piAuthProviders.size > 0) {
    const eligible = listed.filter((entry) => isModelProviderAvailable(entry.spec, piAuthProviders));
    if (eligible.length === 0) return null;
    candidates = eligible;
  }

  const codex = candidates.filter((entry) => entry.provider === "openai-codex");
  const pool = codex.length > 0 ? codex : candidates;

  const wantsTests = modelTier !== "capable" && /\b(test|vitest|jest)\b/i.test(task);
  const capablePool =
    modelTier === "capable"
      ? pool.filter((entry) => !isEconomicalModelId(entry.modelId))
      : pool;
  const searchPool = capablePool.length > 0 ? capablePool : pool;
  const picked =
    (wantsTests ? searchPool.find((entry) => /mini/i.test(entry.modelId)) : undefined) ??
    searchPool.find((entry) => entry.modelId === "gpt-5.4") ??
    searchPool.find((entry) => /gpt-5\.[4-9]/.test(entry.modelId)) ??
    (modelTier === "capable" ? searchPool[searchPool.length - 1] : searchPool[0]);

  if (!picked) return null;

  return {
    modelId: picked.spec,
    reason: "auth-match",
    score: 0,
  };
}

export function routeModel(
  task: string,
  harness: HarnessId,
  registry: Registry,
  options: RouteModelOptions = {},
): RouteModelResult {
  if (harness === "pi" && options.piListedModels && options.piListedModels.length > 0) {
    const listed = routePiFromListedModels(
      task,
      options.piListedModels,
      options.piAuthProviders,
      options.modelTier,
    );
    if (listed) return listed;
  }

  const card = registry.harnesses.find((entry) => entry.id === harness);
  const allModels = card?.models;
  if (!allModels?.length) {
    return { modelId: undefined, reason: "default", score: 0 };
  }

  let models = allModels;
  let authFiltered = false;
  if (harness === "pi" && options.piAuthProviders && options.piAuthProviders.size > 0) {
    const eligible = allModels.filter((model) =>
      isModelProviderAvailable(model.id, options.piAuthProviders!),
    );
    if (eligible.length > 0) {
      models = eligible;
      authFiltered = eligible.length < allModels.length;
    }
  }
  models = modelsForTier(models, options.modelTier);

  const signals = detectSignals(task);
  let bestModel = pickDefaultModelByTier(models, options.modelTier);
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
      modelId: shouldDeferToHarnessDefaultModel(harness)
        ? undefined
        : pickDefaultModelByTier(models, options.modelTier).id,
      reason: authFiltered ? "auth-match" : "default",
      score: 0,
      signals: [...signals],
    };
  }

  return {
    modelId: shouldDeferToHarnessDefaultModel(harness) ? undefined : bestModel.id,
    reason: "ability-match",
    score: bestScore,
    signals: [...signals],
  };
}

export class ModelRouter {
  constructor(
    private readonly registry: Registry,
    private readonly options: RouteModelOptions = {},
  ) {}

  routeModel(task: string, harness: HarnessId, modelTier?: ModelTier): RouteModelResult {
    return routeModel(task, harness, this.registry, { ...this.options, modelTier });
  }
}
