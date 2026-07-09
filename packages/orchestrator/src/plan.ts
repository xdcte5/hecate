import type { HarnessId } from "@relay/schema";
import { ThinRouter } from "@relay/registry";
import type { RunPlan } from "./types.js";
import { analyzeGoal, buildStepTask } from "./goal-analysis.js";

function routeStep(router: ThinRouter, id: string, task: string, wave: number): RunPlan["steps"][number] {
  const route = router.routeTask(task);
  const modelRoute = router.routeModel(task, route.harness);
  return {
    id,
    task,
    harness: route.harness,
    reason: route.reason,
    model: modelRoute.modelId,
    modelReason: modelRoute.reason,
    wave,
  };
}

/**
 * Break a user goal into routed agent steps grouped by execution wave.
 * Steps are derived from goal intent — no automatic unit-test step unless asked.
 */
export function buildRunPlan(goal: string, router: ThinRouter): RunPlan {
  const trimmed = goal.trim();
  const analysis = analyzeGoal(trimmed);
  const steps: RunPlan["steps"] = [];

  switch (analysis.mode) {
    case "test":
      steps.push(routeStep(router, "test", buildStepTask("test", trimmed), 0));
      break;

    case "review":
    case "refactor":
      steps.push(routeStep(router, "review", buildStepTask("review", trimmed), 0));
      break;

    case "fix":
      steps.push(routeStep(router, "fix", buildStepTask("fix", trimmed), 0));
      break;

    case "build":
    default: {
      const parallelImplement = analysis.layers.frontend && analysis.layers.backend;
      if (parallelImplement) {
        steps.push(
          routeStep(router, "implement-frontend", buildStepTask("implement-frontend", trimmed), 0),
        );
        steps.push(
          routeStep(router, "implement-backend", buildStepTask("implement-backend", trimmed), 0),
        );
      } else {
        steps.push(routeStep(router, "implement", trimmed, 0));
      }

      const followUpWave = 1;
      if (analysis.wantsTests) {
        steps.push(routeStep(router, "test", buildStepTask("test", trimmed), followUpWave));
      }
      if (analysis.wantsReview) {
        steps.push(routeStep(router, "review", buildStepTask("review", trimmed), followUpWave));
      }
      break;
    }
  }

  return { goal: trimmed, steps };
}

/**
 * Apply `relay/orchestrator.yaml` routing overrides (step-kind → harness).
 * A key matches a step whose id equals it or starts with `<key>-` (so
 * `implement` covers `implement-frontend`/`implement-backend`). The model is
 * re-routed for the overridden harness.
 */
export function applyRoutingOverrides(
  plan: RunPlan,
  overrides: Record<string, HarnessId> | undefined,
  router: ThinRouter,
): RunPlan {
  if (!overrides || Object.keys(overrides).length === 0) return plan;

  const steps = plan.steps.map((step) => {
    for (const [kind, harness] of Object.entries(overrides)) {
      if (step.id === kind || step.id.startsWith(`${kind}-`)) {
        const modelRoute = router.routeModel(step.task, harness);
        return { ...step, harness, model: modelRoute.modelId, modelReason: modelRoute.reason };
      }
    }
    return step;
  });

  return { ...plan, steps };
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
