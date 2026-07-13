import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { ModelRouter, type RouteModelReason, type RouteModelResult } from "./model-router.js";
import { TaskRouter, routeTask, type RouteTaskReason, type RouteTaskResult } from "./task-router.js";

export type SelectHarnessReason = RouteTaskReason | "capability-match";

export interface SelectHarnessResult {
  harness: HarnessId;
  reason: SelectHarnessReason;
  score?: number;
  signals?: string[];
}

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

export class ThinRouter {
  private readonly taskRouter: TaskRouter;
  private readonly modelRouter: ModelRouter;

  constructor(
    private readonly registry: Registry,
    private readonly policy: SessionPolicy,
  ) {
    this.taskRouter = new TaskRouter(registry, policy);
    this.modelRouter = new ModelRouter(registry);
  }

  selectHarness(task: string): HarnessId {
    return this.taskRouter.routeTask(task).harness;
  }

  selectHarnessDetailed(task: string): SelectHarnessResult {
    const result = this.taskRouter.routeTask(task);
    return {
      harness: result.harness,
      reason: result.reason,
      score: result.score,
      signals: result.signals,
    };
  }

  routeTask(task: string): RouteTaskResult {
    return this.taskRouter.routeTask(task);
  }

  routeModel(task: string, harness: HarnessId): RouteModelResult {
    return this.modelRouter.routeModel(task, harness);
  }
}

export type { RouteModelReason, RouteModelResult };
