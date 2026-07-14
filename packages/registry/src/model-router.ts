import type { HarnessId, Registry } from "@relay/schema";
import { isModelProviderAvailable } from "./model-provider.js";
import { detectSignals, scoreAbilities } from "./task-signals.js";

export type PiListedModelRef = {
  provider: string;
  modelId: string;
  spec: string;
};

export type RouteModelReason = "ability-match" | "default" | "auth-match";

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
};

function routePiFromListedModels(
  task: string,
  listed: PiListedModelRef[],
  piAuthProviders?: Set<string>,
): RouteModelResult | null {
  let candidates = listed;
  if (piAuthProviders && piAuthProviders.size > 0) {
    const eligible = listed.filter((entry) => isModelProviderAvailable(entry.spec, piAuthProviders));
    if (eligible.length > 0) candidates = eligible;
  }

  const codex = candidates.filter((entry) => entry.provider === "openai-codex");
  const pool = codex.length > 0 ? codex : candidates;

  const wantsTests = /\b(test|vitest|jest)\b/i.test(task);
  const picked =
    (wantsTests ? pool.find((entry) => /mini/i.test(entry.modelId)) : undefined) ??
    pool.find((entry) => entry.modelId === "gpt-5.4") ??
    pool.find((entry) => /gpt-5\.[4-9]/.test(entry.modelId)) ??
    pool[0];

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
    const listed = routePiFromListedModels(task, options.piListedModels, options.piAuthProviders);
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
      reason: authFiltered ? "auth-match" : "default",
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
  constructor(
    private readonly registry: Registry,
    private readonly options: RouteModelOptions = {},
  ) {}

  routeModel(task: string, harness: HarnessId): RouteModelResult {
    return routeModel(task, harness, this.registry, this.options);
  }
}
