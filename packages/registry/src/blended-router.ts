import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  RoutingOutcomeSchema,
  RoutingPriorsSchema,
  resolveSessionPolicyRoutingConfig,
  resolveSessionPolicyStepRouting,
  type HarnessCard,
  type HarnessId,
  type Registry,
  type RoutingBlend,
  type RoutingPriors,
  type SessionPolicy,
} from "@relay/schema";
import {
  applySignalAdjustments,
  clampPrior,
  EMPTY_ROUTING_PRIORS,
  getBenchmarkPrior,
  loadRoutingPriors,
  ROUTING_PRIORS_RELATIVE_PATH,
} from "./routing-priors.js";
import {
  aggregateMedianCosts,
  aggregateSuccessRates,
  aggregateKey,
  getLocalCostMedian,
  getLocalScore,
  readRoutingStats,
  ROUTING_STATS_RELATIVE_PATH,
  type AggregateKey,
  type CostAggregate,
  type CostAggregateKey,
  type SuccessRateAggregate,
} from "./routing-stats-reader.js";
import {
  routeModel,
  modelsForTier,
  shouldDeferToHarnessDefaultModel,
  type ModelTier,
  type RouteModelOptions,
  type RouteModelReason,
} from "./model-router.js";
import { isModelProviderAvailable } from "./model-provider.js";
import { routeTask, type RouteTaskReason } from "./task-router.js";
import { detectSignals, scoreAbilities } from "./task-signals.js";
import {
  filterCandidatesByPrefer,
  pickByHarnessOrder,
  preferListForTaskType,
  resolveHarnessOrder,
} from "./step-routing-order.js";

export interface BlendedScoreBreakdown {
  local: number | null;
  benchmark: number;
  heuristic: number;
  cost: number | null;
  blended: number;
}

export interface BlendedRouteResult {
  harness: HarnessId;
  reason: RouteTaskReason | "blended";
  score: number;
  signals?: string[];
  breakdown: BlendedScoreBreakdown;
}

export interface BlendedModelRouteResult {
  modelId?: string;
  reason: RouteModelReason;
  score: number;
  signals?: string[];
  breakdown: BlendedScoreBreakdown;
}

type CandidateScore = {
  id: string;
  rawHeuristic: number;
  breakdown: Omit<BlendedScoreBreakdown, "blended">;
  blended: number;
};

function loadRoutingPriorsSync(cwd: string): RoutingPriors {
  try {
    const content = readFileSync(join(cwd, ROUTING_PRIORS_RELATIVE_PATH), "utf8");
    return RoutingPriorsSchema.parse(parseYaml(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_ROUTING_PRIORS;
    }
    throw error;
  }
}

async function ensureRoutingData(
  cwd: string,
  cache: BlendedRouterCache,
): Promise<{
  priors: RoutingPriors;
  aggregates: Map<AggregateKey, SuccessRateAggregate>;
  costAggregates: Map<CostAggregateKey, CostAggregate>;
}> {
  if (cache.loaded) {
    return {
      priors: cache.priors,
      aggregates: cache.aggregates,
      costAggregates: cache.costAggregates,
    };
  }

  const [priors, stats] = await Promise.all([
    loadRoutingPriors(cwd),
    readRoutingStats(cwd),
  ]);
  const minSamples = cache.minSamples;
  cache.priors = priors;
  cache.aggregates = aggregateSuccessRates(stats, minSamples);
  cache.costAggregates = aggregateMedianCosts(stats, minSamples);
  cache.loaded = true;
  return {
    priors: cache.priors,
    aggregates: cache.aggregates,
    costAggregates: cache.costAggregates,
  };
}

function loadRoutingDataSync(
  cwd: string,
  minSamples: number,
): {
  priors: RoutingPriors;
  aggregates: Map<AggregateKey, SuccessRateAggregate>;
  costAggregates: Map<CostAggregateKey, CostAggregate>;
} {
  const priors = loadRoutingPriorsSync(cwd);
  try {
    const content = readFileSync(join(cwd, ROUTING_STATS_RELATIVE_PATH), "utf8");
    const stats = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => RoutingOutcomeSchema.parse(JSON.parse(line)));
    return {
      priors,
      aggregates: aggregateSuccessRates(stats, minSamples),
      costAggregates: aggregateMedianCosts(stats, minSamples),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { priors, aggregates: new Map(), costAggregates: new Map() };
    }
    throw error;
  }
}

type BlendedRouterCache = {
  loaded: boolean;
  priors: RoutingPriors;
  aggregates: Map<AggregateKey, SuccessRateAggregate>;
  costAggregates: Map<CostAggregateKey, CostAggregate>;
  minSamples: number;
};

export function effectiveBlendWeights(
  blend: RoutingBlend,
  hasLocal: boolean,
  hasCost = false,
): RoutingBlend {
  let weights: RoutingBlend = { ...blend };

  const redistribute = (from: keyof RoutingBlend) => {
    const amount = weights[from];
    weights[from] = 0;
    const targets = (["local", "benchmark", "heuristic", "cost"] as const).filter(
      (key) => key !== from && weights[key] > 0,
    );
    const otherTotal = targets.reduce((sum, key) => sum + weights[key], 0);
    if (otherTotal <= 0) {
      weights = { local: 0, benchmark: 0.33, heuristic: 0.33, cost: 0.34 };
      return;
    }
    for (const target of targets) {
      weights[target] = weights[target] + amount * (weights[target] / otherTotal);
    }
  };

  if (!hasLocal) redistribute("local");
  if (!hasCost) redistribute("cost");

  return weights;
}

export function normalizeHeuristicScores(
  rawScores: Map<string, number>,
): Map<string, number> {
  const values = [...rawScores.values()];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const normalized = new Map<string, number>();

  if (max <= 0) {
    for (const key of rawScores.keys()) {
      normalized.set(key, 0);
    }
    return normalized;
  }

  if (max === min) {
    for (const key of rawScores.keys()) {
      normalized.set(key, 1);
    }
    return normalized;
  }

  for (const [key, score] of rawScores) {
    normalized.set(key, (score - min) / (max - min));
  }
  return normalized;
}

/** Normalize median costs to 0-1 where lower cost scores higher. */
export function normalizeCostScores(
  medianCosts: Map<string, number | null>,
): Map<string, number> {
  const values = [...medianCosts.values()].filter((value): value is number => value !== null);
  const normalized = new Map<string, number>();

  if (values.length === 0) {
    for (const key of medianCosts.keys()) {
      normalized.set(key, 0);
    }
    return normalized;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);

  if (max === min) {
    for (const [key, cost] of medianCosts) {
      normalized.set(key, cost !== null ? 1 : 0);
    }
    return normalized;
  }

  for (const [key, cost] of medianCosts) {
    normalized.set(key, cost === null ? 0 : (max - cost) / (max - min));
  }
  return normalized;
}

function filterHarnessCards(
  registry: Registry,
  installedHarnesses?: HarnessId[],
): HarnessCard[] {
  if (!installedHarnesses || installedHarnesses.length === 0) {
    return registry.harnesses;
  }
  const allowed = new Set(installedHarnesses);
  return registry.harnesses.filter((card) => allowed.has(card.id));
}

function scoreHarnessHeuristic(card: HarnessCard, task: string, signals: Set<string>): number {
  return scoreAbilities(card.strengths, card.weaknesses, task, signals);
}

function pickHarnessCandidate<T extends { id: string; blended: number }>(
  candidates: T[],
  policy: SessionPolicy,
  taskType: string,
  maxBlended: number,
): T | undefined {
  if (candidates.length === 0) return undefined;

  const stepRouting = resolveSessionPolicyStepRouting(policy);
  const prefer = preferListForTaskType(stepRouting, taskType);
  const filtered = filterCandidatesByPrefer(candidates, prefer, policy.failover);
  const order = resolveHarnessOrder(prefer, policy.failover);
  return pickByHarnessOrder(filtered, order, maxBlended);
}

function buildBlendedScore(
  local: number | null,
  benchmark: number,
  heuristic: number,
  cost: number,
  weights: RoutingBlend,
): number {
  const localComponent = local ?? 0;
  return (
    weights.local * localComponent +
    weights.benchmark * benchmark +
    weights.heuristic * heuristic +
    weights.cost * cost
  );
}

export class BlendedRouter {
  private readonly cache: BlendedRouterCache;

  constructor(
    private readonly registry: Registry,
    private readonly policy: SessionPolicy,
    private readonly cwd: string,
    private readonly modelOptions: RouteModelOptions = {},
  ) {
    const routingConfig = resolveSessionPolicyRoutingConfig(policy);
    this.cache = {
      loaded: false,
      priors: EMPTY_ROUTING_PRIORS,
      aggregates: new Map(),
      costAggregates: new Map(),
      minSamples: routingConfig.min_local_samples,
    };
  }

  private get routingConfig() {
    return resolveSessionPolicyRoutingConfig(this.policy);
  }

  private loadDataSync() {
    if (this.cache.loaded) return;
    const { priors, aggregates, costAggregates } = loadRoutingDataSync(
      this.cwd,
      this.cache.minSamples,
    );
    this.cache.priors = priors;
    this.cache.aggregates = aggregates;
    this.cache.costAggregates = costAggregates;
    this.cache.loaded = true;
  }

  async preload(): Promise<void> {
    await ensureRoutingData(this.cwd, this.cache);
  }

  routeTaskBlended(task: string, taskType: string): BlendedRouteResult {
    this.loadDataSync();
    const signals = detectSignals(task);
    const cards = filterHarnessCards(this.registry, this.modelOptions.installedHarnesses);
    const { priors, aggregates, costAggregates } = this.cache;
    const blend = this.routingConfig.blend;

    const rawHeuristic = new Map<string, number>();
    for (const card of cards) {
      rawHeuristic.set(card.id, scoreHarnessHeuristic(card, task, signals));
    }
    const heuristicNorm = normalizeHeuristicScores(rawHeuristic);

    const medianCosts = new Map<string, number | null>();
    for (const card of cards) {
      medianCosts.set(
        card.id,
        getLocalCostMedian(costAggregates, taskType, card.id, this.cache.minSamples),
      );
    }
    const costNorm = normalizeCostScores(medianCosts);
    const hasCost = [...medianCosts.values()].some((value) => value !== null);

    const minSuccessRate = this.routingConfig.min_success_rate;
    const candidates: CandidateScore[] = [];
    for (const card of cards) {
      const aggregate = aggregates.get(aggregateKey(taskType, card.id, ""));
      if (
        aggregate &&
        aggregate.count >= this.cache.minSamples &&
        aggregate.rate < minSuccessRate
      ) {
        continue;
      }

      const local = getLocalScore(
        aggregates,
        taskType,
        card.id,
        "",
        this.cache.minSamples,
      );
      const benchmark = clampPrior(
        getBenchmarkPrior(priors, taskType, card.id) +
          applySignalAdjustments(priors, signals, card.id),
      );
      const heuristic = heuristicNorm.get(card.id) ?? 0;
      const cost = costNorm.get(card.id) ?? 0;
      const weights = effectiveBlendWeights(blend, local !== null, hasCost);
      const blended = buildBlendedScore(local, benchmark, heuristic, cost, weights);

      candidates.push({
        id: card.id,
        rawHeuristic: rawHeuristic.get(card.id) ?? 0,
        blended,
        breakdown: {
          local,
          benchmark,
          heuristic,
          cost: medianCosts.get(card.id) !== null ? (costNorm.get(card.id) ?? null) : null,
        },
      });
    }

    const eligible =
      candidates.length > 0
        ? candidates
        : cards.map((card) => ({
            id: card.id,
            rawHeuristic: rawHeuristic.get(card.id) ?? 0,
            blended: 0,
            breakdown: {
              local: null as number | null,
              benchmark: 0,
              heuristic: 0,
              cost: null as number | null,
            },
          }));

    const maxBlended = Math.max(...eligible.map((candidate) => candidate.blended), 0);
    const picked = pickHarnessCandidate(eligible, this.policy, taskType, maxBlended);
    if (!picked) {
      throw new Error("Session policy failover order must not be empty");
    }

    const reason: BlendedRouteResult["reason"] =
      maxBlended <= 0 || picked.rawHeuristic <= 0 ? "failover" : "blended";

    return {
      harness: picked.id as HarnessId,
      reason,
      score: picked.blended,
      signals: [...signals],
      breakdown: {
        ...picked.breakdown,
        blended: picked.blended,
      },
    };
  }

  routeModelBlended(
    task: string,
    taskType: string,
    harness: HarnessId,
    modelTier?: ModelTier,
  ): BlendedModelRouteResult {
    this.loadDataSync();
    const listedPiModel = this.routeListedPiModel(task, harness, modelTier);
    if (listedPiModel) return listedPiModel;

    const signals = detectSignals(task);
    const models = modelsForTier(this.eligibleModels(harness), modelTier);
    if (models.length === 0) {
      const heuristicResult = routeModel(task, harness, this.registry, {
        ...this.modelOptions,
        modelTier,
      });
      return {
        modelId: heuristicResult.modelId,
        reason: heuristicResult.reason,
        score: heuristicResult.score,
        signals: heuristicResult.signals,
        breakdown: {
          local: null,
          benchmark: DEFAULT_MODEL_BENCHMARK,
          heuristic: 0,
          cost: null,
          blended: DEFAULT_MODEL_BENCHMARK,
        },
      };
    }

    const { priors, aggregates, costAggregates } = this.cache;
    const blend = this.routingConfig.blend;

    const rawHeuristic = new Map<string, number>();
    for (const model of models) {
      rawHeuristic.set(model.id, scoreAbilities(model.strengths, model.weaknesses ?? [], task, signals));
    }
    const heuristicNorm = normalizeHeuristicScores(rawHeuristic);

    const harnessCostMedian = getLocalCostMedian(
      costAggregates,
      taskType,
      harness,
      this.cache.minSamples,
    );
    const hasCost = harnessCostMedian !== null;

    const candidates: CandidateScore[] = [];
    for (const model of models) {
      const local = getLocalScore(
        aggregates,
        taskType,
        harness,
        model.id,
        this.cache.minSamples,
      );
      const benchmark = clampPrior(
        getBenchmarkPrior(priors, taskType, harness, model.id) +
          applySignalAdjustments(priors, signals, harness, model.id),
      );
      const heuristic = heuristicNorm.get(model.id) ?? 0;
      const cost = hasCost ? 1 : 0;
      const weights = effectiveBlendWeights(blend, local !== null, hasCost);
      const blended = buildBlendedScore(local, benchmark, heuristic, cost, weights);

      candidates.push({
        id: model.id,
        rawHeuristic: rawHeuristic.get(model.id) ?? 0,
        blended,
        breakdown: { local, benchmark, heuristic, cost: hasCost ? 1 : null },
      });
    }

    const maxBlended = Math.max(...candidates.map((candidate) => candidate.blended), 0);
    const picked =
      candidates.reduce((best, current) =>
        current.blended > best.blended ? current : best,
      ) ?? candidates[0]!;

    const reason: RouteModelReason =
      maxBlended <= 0 || picked.rawHeuristic <= 0 ? "default" : "ability-match";

    return {
      modelId: shouldDeferToHarnessDefaultModel(harness) ? undefined : picked.id,
      reason,
      score: picked.blended,
      signals: [...signals],
      breakdown: {
        ...picked.breakdown,
        blended: picked.blended,
      },
    };
  }

  routeModelBenchmarkOnly(
    task: string,
    taskType: string,
    harness: HarnessId,
    modelTier?: ModelTier,
  ): BlendedModelRouteResult {
    this.loadDataSync();
    const listedPiModel = this.routeListedPiModel(task, harness, modelTier);
    if (listedPiModel) return listedPiModel;

    const signals = detectSignals(task);
    const models = modelsForTier(this.eligibleModels(harness), modelTier);
    if (models.length === 0) {
      const heuristicResult = routeModel(task, harness, this.registry, {
        ...this.modelOptions,
        modelTier,
      });
      return {
        modelId: heuristicResult.modelId,
        reason: heuristicResult.reason,
        score: heuristicResult.score,
        signals: heuristicResult.signals,
        breakdown: {
          local: null,
          benchmark: DEFAULT_MODEL_BENCHMARK,
          heuristic: 0,
          cost: null,
          blended: DEFAULT_MODEL_BENCHMARK,
        },
      };
    }

    const { priors } = this.cache;
    const candidates: CandidateScore[] = models.map((model) => {
      const benchmark = clampPrior(
        getBenchmarkPrior(priors, taskType, harness, model.id) +
          applySignalAdjustments(priors, signals, harness, model.id),
      );
      return {
        id: model.id,
        rawHeuristic: 0,
        blended: benchmark,
        breakdown: { local: null, benchmark, heuristic: 0, cost: null },
      };
    });

    const picked =
      candidates.reduce((best, current) =>
        current.blended > best.blended ? current : best,
      ) ?? candidates[0]!;

    return {
      modelId: shouldDeferToHarnessDefaultModel(harness) ? undefined : picked.id,
      reason: "default",
      score: picked.blended,
      signals: [...signals],
      breakdown: {
        ...picked.breakdown,
        blended: picked.blended,
      },
    };
  }

  private eligibleModels(harness: HarnessId) {
    const card = this.registry.harnesses.find((entry) => entry.id === harness);
    const allModels = card?.models ?? [];
    if (harness !== "pi" || !this.modelOptions.piAuthProviders || this.modelOptions.piAuthProviders.size === 0) {
      return allModels;
    }

    const eligible = allModels.filter((model) =>
      isModelProviderAvailable(model.id, this.modelOptions.piAuthProviders!),
    );
    return eligible.length > 0 ? eligible : allModels;
  }

  private routeListedPiModel(
    task: string,
    harness: HarnessId,
    modelTier?: ModelTier,
  ): BlendedModelRouteResult | null {
    if (harness !== "pi" || !this.modelOptions.piListedModels?.length) {
      return null;
    }

    const heuristicResult = routeModel(task, harness, this.registry, {
      ...this.modelOptions,
      modelTier,
    });
    if (!heuristicResult.modelId) {
      return null;
    }

    return {
      modelId: heuristicResult.modelId,
      reason: heuristicResult.reason,
      score: heuristicResult.score,
      signals: heuristicResult.signals,
      breakdown: {
        local: null,
        benchmark: DEFAULT_MODEL_BENCHMARK,
        heuristic: 0,
        cost: null,
        blended: DEFAULT_MODEL_BENCHMARK,
      },
    };
  }

  routeTaskBenchmarkOnly(task: string, taskType: string): BlendedRouteResult {
    this.loadDataSync();
    const signals = detectSignals(task);
    const cards = filterHarnessCards(this.registry, this.modelOptions.installedHarnesses);
    const { priors } = this.cache;

    const candidates: CandidateScore[] = cards.map((card) => {
      const benchmark = clampPrior(
        getBenchmarkPrior(priors, taskType, card.id) +
          applySignalAdjustments(priors, signals, card.id),
      );
      return {
        id: card.id,
        rawHeuristic: 0,
        blended: benchmark,
        breakdown: { local: null, benchmark, heuristic: 0, cost: null },
      };
    });

    const maxBlended = Math.max(...candidates.map((candidate) => candidate.blended), 0);
    const picked = pickHarnessCandidate(candidates, this.policy, taskType, maxBlended);
    if (!picked) {
      throw new Error("Session policy failover order must not be empty");
    }

    return {
      harness: picked.id as HarnessId,
      reason: maxBlended <= 0 ? "failover" : "blended",
      score: picked.blended,
      signals: [...signals],
      breakdown: {
        ...picked.breakdown,
        blended: picked.blended,
      },
    };
  }
}

const DEFAULT_MODEL_BENCHMARK = 0.5;

export function routeTaskHeuristic(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): BlendedRouteResult {
  const result = routeTask(task, registry, policy);
  return {
    harness: result.harness,
    reason: result.reason,
    score: result.score,
    signals: result.signals,
    breakdown: {
      local: null,
      benchmark: 0,
      heuristic: result.score > 0 ? 1 : 0,
      cost: null,
      blended: result.score,
    },
  };
}
