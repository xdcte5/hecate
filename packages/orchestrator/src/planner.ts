import type { ThinRouter } from "@relay/registry";
import type { RunPlan } from "./types.js";

export type PlannerOptions = {
  goal: string;
  router: ThinRouter;
};

/**
 * Pro hook: LLM-based plan refinement.
 * OSS uses heuristic routing in `buildRunPlan`.
 */
export async function refinePlanWithLlm(_options: PlannerOptions): Promise<RunPlan | null> {
  return null;
}
