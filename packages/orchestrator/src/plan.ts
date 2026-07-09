import type { HarnessId } from "@relay/schema";
import { ThinRouter } from "@relay/registry";
import type { RunPlan } from "./types.js";

function shouldAddTestStep(goal: string, primaryHarness: HarnessId): boolean {
  if (/\b(test|tests|vitest|jest)\b/i.test(goal)) return false;
  if (primaryHarness === "codex") return false;
  return true;
}

function shouldAddReviewStep(goal: string): boolean {
  return /\b(refactor|architecture|system|migrate|redesign)\b/i.test(goal);
}

/** Break a user goal into routed agent steps. */
export function buildRunPlan(goal: string, router: ThinRouter): RunPlan {
  const trimmed = goal.trim();
  const steps: RunPlan["steps"] = [];

  const primary = router.selectHarnessDetailed(trimmed);
  steps.push({
    id: "implement",
    task: trimmed,
    harness: primary.harness,
    reason: primary.reason,
  });

  if (shouldAddTestStep(trimmed, primary.harness)) {
    const testTask = `write unit tests for: ${trimmed}`;
    const testRoute = router.selectHarnessDetailed(testTask);
    steps.push({
      id: "test",
      task: testTask,
      harness: testRoute.harness,
      reason: testRoute.reason,
    });
  }

  if (shouldAddReviewStep(trimmed)) {
    const reviewTask = `review architecture and risks for: ${trimmed}`;
    const reviewRoute = router.selectHarnessDetailed(reviewTask);
    steps.push({
      id: "review",
      task: reviewTask,
      harness: reviewRoute.harness,
      reason: reviewRoute.reason,
    });
  }

  return { goal: trimmed, steps };
}
