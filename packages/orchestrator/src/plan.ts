import type { SessionPolicy, StepRouting, StepRoutingRule } from "@relay/schema";
import { resolveSessionPolicyStepRouting } from "@relay/schema";
import type { BlendedRouteResult, SelectHarnessReason, ThinRouter } from "@relay/registry";
import { applyStepRoutingPrefer, stepRoutingKeyForTaskType } from "@relay/registry";
import type { RouteBreakdown, RunPlan } from "./types.js";
import type { VerifierSpec } from "./verifiers/types.js";
import {
  analyzeGoal,
  buildStepTask,
  classifyStepTask,
  isTrivialGoal,
  type StepTaskType,
} from "./goal-analysis.js";

function toRouteBreakdown(result: BlendedRouteResult): RouteBreakdown {
  return {
    local: result.breakdown.local ?? undefined,
    benchmark: result.breakdown.benchmark,
    heuristic: result.breakdown.heuristic,
  };
}

function applyStepRoutingModelTier(
  taskType: StepTaskType,
  stepRouting: StepRouting | undefined,
): StepRoutingRule["model_tier"] {
  if (!stepRouting) return undefined;
  return stepRouting[stepRoutingKeyForTaskType(taskType)]?.model_tier;
}

function inferVerifierSpecs(task: string): VerifierSpec[] | undefined {
  const lower = task.toLowerCase();

  if (lower.includes("hello.sh") && lower.includes("hello")) {
    return [
      { type: "artifact", path: "hello.sh" },
      { type: "shell", command: "bash hello.sh", expectStdout: "hello\n" },
    ];
  }

  if (lower.includes("add.py") && lower.includes("add") && lower.includes("a+b")) {
    return [{ type: "python", code: "from add import add; assert add(2, 3) == 5" }];
  }

  if (lower.includes("fib.py") && lower.includes("fib")) {
    return [{ type: "python", code: "from fib import fib; assert fib(10) == 55" }];
  }

  return undefined;
}

function routeStep(
  router: ThinRouter,
  id: string,
  task: string,
  wave: number,
  policy?: SessionPolicy,
): RunPlan["steps"][number] {
  const taskType = classifyStepTask(id, task);
  const route = router.routeTask(task, taskType);
  const stepRouting = policy ? resolveSessionPolicyStepRouting(policy) : undefined;
  const failover = policy?.failover ?? [];
  const prefer = stepRouting
    ? stepRouting[stepRoutingKeyForTaskType(taskType)]?.prefer
    : undefined;
  const harness = applyStepRoutingPrefer(route.harness, prefer, failover);
  const modelTier = applyStepRoutingModelTier(taskType, stepRouting);
  const modelRoute = router.routeModel(task, harness, taskType, modelTier);
  const blended = "breakdown" in route;
  const reason: SelectHarnessReason =
    route.reason === "failover" || route.reason === "ability-match"
      ? route.reason
      : "ability-match";
  const preferApplied = harness !== route.harness;

  return {
    id,
    task,
    harness,
    reason: preferApplied ? "failover" : reason,
    routeReason: blended ? "blended" : route.reason,
    routeBreakdown: blended ? toRouteBreakdown(route as BlendedRouteResult) : undefined,
    model: modelRoute.modelId,
    modelReason: modelRoute.reason,
    verify: inferVerifierSpecs(task),
    ...(modelTier ? { modelTier } : {}),
    wave,
  };
}

/**
 * Break a user goal into routed agent steps grouped by execution wave.
 * Steps are derived from goal intent — no automatic unit-test step unless asked.
 */
export function buildRunPlan(goal: string, router: ThinRouter, policy?: SessionPolicy): RunPlan {
  const trimmed = goal.trim();
  const analysis = analyzeGoal(trimmed);
  const steps: RunPlan["steps"] = [];

  if (isTrivialGoal(trimmed)) {
    steps.push(routeStep(router, "implement", trimmed, 0, policy));
    return { goal: trimmed, steps };
  }

  switch (analysis.mode) {
    case "chat":
      steps.push(routeStep(router, "chat", trimmed, 0, policy));
      break;

    case "test":
      steps.push(routeStep(router, "test", buildStepTask("test", trimmed), 0, policy));
      break;

    case "review":
    case "refactor":
      steps.push(routeStep(router, "review", buildStepTask("review", trimmed), 0, policy));
      break;

    case "fix":
      steps.push(routeStep(router, "fix", buildStepTask("fix", trimmed), 0, policy));
      break;

    case "build":
    default: {
      const parallelImplement = analysis.layers.frontend && analysis.layers.backend;
      if (parallelImplement) {
        steps.push(
          routeStep(router, "implement-frontend", buildStepTask("implement-frontend", trimmed), 0, policy),
        );
        steps.push(
          routeStep(router, "implement-backend", buildStepTask("implement-backend", trimmed), 0, policy),
        );
      } else {
        steps.push(routeStep(router, "implement", trimmed, 0, policy));
      }

      const followUpWave = 1;
      if (analysis.wantsTests) {
        steps.push(routeStep(router, "test", buildStepTask("test", trimmed), followUpWave, policy));
      }
      if (analysis.wantsReview) {
        steps.push(routeStep(router, "review", buildStepTask("review", trimmed), followUpWave, policy));
      }
      break;
    }
  }

  return { goal: trimmed, steps };
}

export function groupStepsByWave<T extends { wave: number }>(steps: T[]): Map<number, T[]> {
  const waves = new Map<number, T[]>();
  for (const step of steps) {
    const list = waves.get(step.wave) ?? [];
    list.push(step);
    waves.set(step.wave, list);
  }
  return new Map([...waves.entries()].sort((a, b) => a[0] - b[0]));
}
