import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { resolveSessionPolicyRoutingConfig } from "@relay/schema";
import {
  BlendedRouter,
  routeTaskHeuristic,
  type BlendedRouteResult,
  type BlendedModelRouteResult,
} from "./blended-router.js";
import { ModelRouter, routeModel, type ModelTier, type RouteModelOptions, type RouteModelReason, type RouteModelResult } from "./model-router.js";
import { TaskRouter, routeTask, type RouteTaskReason, type RouteTaskResult } from "./task-router.js";
import { detectSignals } from "./task-signals.js";

export type SelectHarnessReason = RouteTaskReason | "blended";

export interface SelectHarnessResult {
  harness: HarnessId;
  reason: SelectHarnessReason;
  score?: number;
  signals?: string[];
  breakdown?: BlendedRouteResult["breakdown"];
}

export type { BlendedRouteResult, BlendedModelRouteResult, BlendedScoreBreakdown } from "./blended-router.js";

export function selectHarness(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): HarnessId {
  return selectHarnessDetailed(task, registry, policy).harness;
}

export function selectHarnessDetailed(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): SelectHarnessResult {
  const result = routeTask(task, registry, policy);
  return {
    harness: result.harness,
    reason: result.reason,
    score: result.score,
    signals: result.signals,
  };
}

function inferTaskType(task: string): string {
  const signals = detectSignals(task);
  if (signals.size === 0) return "general";
  return [...signals][0]!;
}

export class ThinRouter {
  private readonly taskRouter: TaskRouter;
  private readonly modelRouter: ModelRouter;
  private readonly blendedRouter?: BlendedRouter;
  private readonly routingMode: "auto" | "heuristic" | "benchmark";

  constructor(
    private readonly registry: Registry,
    private readonly policy: SessionPolicy,
    modelOptions: RouteModelOptions = {},
    cwd?: string,
  ) {
    this.taskRouter = new TaskRouter(registry, policy);
    this.modelRouter = new ModelRouter(registry, modelOptions);
    this.routingMode = resolveSessionPolicyRoutingConfig(policy).mode;
    if (cwd && this.routingMode !== "heuristic") {
      this.blendedRouter = new BlendedRouter(registry, policy, cwd, modelOptions);
    }
  }

  selectHarness(task: string, taskType?: string): HarnessId {
    return this.selectHarnessDetailed(task, taskType).harness;
  }

  selectHarnessDetailed(task: string, taskType?: string): SelectHarnessResult {
    const result = this.routeTask(task, taskType);
    return {
      harness: result.harness,
      reason: result.reason,
      score: result.score,
      signals: result.signals,
      breakdown: "breakdown" in result ? result.breakdown : undefined,
    };
  }

  routeTask(task: string, taskType?: string): RouteTaskResult | BlendedRouteResult {
    const resolvedTaskType = taskType ?? inferTaskType(task);

    if (this.routingMode === "heuristic" || !this.blendedRouter) {
      return this.taskRouter.routeTask(task);
    }

    if (this.routingMode === "benchmark") {
      return this.blendedRouter.routeTaskBenchmarkOnly(task, resolvedTaskType);
    }

    return this.blendedRouter.routeTaskBlended(task, resolvedTaskType);
  }

  routeModel(task: string, harness: HarnessId, taskType?: string, modelTier?: ModelTier): RouteModelResult | BlendedModelRouteResult {
    if (this.routingMode === "heuristic" || !this.blendedRouter) {
      return this.modelRouter.routeModel(task, harness, modelTier);
    }

    const resolvedTaskType = taskType ?? inferTaskType(task);
    if (this.routingMode === "benchmark") {
      return this.blendedRouter.routeModelBenchmarkOnly(task, resolvedTaskType, harness, modelTier);
    }

    return this.blendedRouter.routeModelBlended(task, resolvedTaskType, harness, modelTier);
  }

  routeTaskBlended(task: string, taskType: string): BlendedRouteResult {
    if (this.blendedRouter) {
      return this.blendedRouter.routeTaskBlended(task, taskType);
    }
    return routeTaskHeuristic(task, this.registry, this.policy);
  }

  routeModelBlended(task: string, taskType: string, harness: HarnessId, modelTier?: ModelTier): BlendedModelRouteResult {
    if (this.blendedRouter) {
      return this.blendedRouter.routeModelBlended(task, taskType, harness, modelTier);
    }
    const result = routeModel(task, harness, this.registry, { modelTier });
    return {
      modelId: result.modelId,
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
}

export type { RouteModelReason, RouteModelResult };
