import type { HarnessId } from "@relay/schema";
import type { RunStep } from "./types.js";
import type { GateVerdict } from "./verifiers/types.js";

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
  step.model = undefined;
  step.modelReason = undefined;
  step.lastVerifyVerdict = undefined;
  step.verifyFailureEvidence = undefined;
}

export function suggestVerifyRetry(
  step: RunStep,
  verdict: GateVerdict,
  options: { maxRetries?: number } = {},
): { feedback: string; retryNumber: number; maxRetries: number } | null {
  const maxRetries = options.maxRetries ?? 3;
  const retryNumber = step.verifyRetries ?? 0;
  if (retryNumber >= maxRetries) return null;

  return {
    retryNumber: retryNumber + 1,
    maxRetries,
    feedback: [
      "The previous attempt completed, but Relay verifiers blocked it.",
      `Verifier verdict: ${verdict.recommendation} (${verdict.confidence.toFixed(2)} confidence).`,
      `Evidence: ${verdict.evidence}`,
      "Fix the implementation so the verifier passes. Do not hand off until the check succeeds.",
    ].join("\n"),
  };
}

export function applyVerifyRetry(
  step: RunStep,
  feedback: string,
  retryNumber: number,
): void {
  step.verifyRetries = retryNumber;
  step.verifyFeedback = feedback;
  step.task = `${step.task}\n\nVerifier feedback from prior attempt:\n${feedback}`;
  step.status = "pending";
  step.error = undefined;
  step.startedAt = undefined;
  step.finishedAt = undefined;
  step.result = undefined;
  step.binary = undefined;
  step.lastVerifyVerdict = undefined;
}
