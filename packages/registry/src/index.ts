export {
  loadRegistry,
  loadSessionPolicy,
  loadRelayConfig,
  REGISTRY_RELATIVE_PATH,
  SESSION_POLICY_RELATIVE_PATH,
} from "./load-registry.js";

export {
  ThinRouter,
  selectHarness,
  selectHarnessDetailed,
  type SelectHarnessReason,
  type SelectHarnessResult,
  type BlendedRouteResult,
  type BlendedModelRouteResult,
  type BlendedScoreBreakdown,
} from "./thin-router.js";

export {
  BlendedRouter,
  effectiveBlendWeights,
  normalizeHeuristicScores,
  routeTaskHeuristic,
} from "./blended-router.js";

export {
  loadRoutingPriors,
  getBenchmarkPrior,
  applySignalAdjustments,
  clampPrior,
  EMPTY_ROUTING_PRIORS,
  ROUTING_PRIORS_RELATIVE_PATH,
} from "./routing-priors.js";

export {
  readRoutingStats,
  aggregateSuccessRates,
  aggregateMedianCosts,
  getLocalScore,
  getLocalCostMedian,
  getHarnessLocalStats,
  isHarnessExcludedByConfidence,
  computePriorDrift,
  formatPriorDriftReport,
  aggregateKey,
  ROUTING_STATS_RELATIVE_PATH,
  type SuccessRateAggregate,
  type CostAggregate,
  type AggregateKey,
  type CostAggregateKey,
  type PriorDriftRow,
} from "./routing-stats-reader.js";

export {
  applyStepRoutingPrefer,
  filterCandidatesByPrefer,
  pickByHarnessOrder,
  preferListForTaskType,
  resolveHarnessOrder,
  stepRoutingKeyForTaskType,
} from "./step-routing-order.js";

export {
  TaskRouter,
  routeTask,
  type RouteTaskReason,
  type RouteTaskResult,
} from "./task-router.js";

export {
  ModelRouter,
  routeModel,
  modelsForTier,
  pickDefaultModelByTier,
  type RouteModelOptions,
  type RouteModelReason,
  type RouteModelResult,
  type ModelTier,
} from "./model-router.js";

export {
  inferModelProvider,
  isModelProviderAvailable,
  type ModelProviderId,
} from "./model-provider.js";
