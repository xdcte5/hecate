import type { HarnessId } from "@relay/schema";
import type { RunStep } from "./types.js";

export type FailoverRetrySuggestion = {
  harness: HarnessId;
  message: string;
};

/** Pick the next failover harness after a step failure (one retry max). */
export function suggestFailoverRetry(
  step: Pick<RunStep, "harness" | "id" | "task">,
  failover: HarnessId[],
  options: { alreadyRetried?: boolean } = {},
): FailoverRetrySuggestion | null {
  if (options.alreadyRetried) return null;

  const next = failover.find((harness) => harness !== step.harness);
  if (!next) return null;

  return {
    harness: next,
    message: `Step "${step.id}" failed on ${step.harness}; retrying with ${next}`,
  };
}

/** Reset a failed step for a single failover retry. */
export function applyFailoverRetry(step: RunStep, harness: HarnessId): void {
  step.harness = harness;
  step.reason = "failover";
  step.status = "pending";
  step.error = undefined;
  step.startedAt = undefined;
  step.finishedAt = undefined;
  step.result = undefined;
  step.binary = undefined;
}
