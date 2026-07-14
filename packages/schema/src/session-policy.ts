import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const RoutingRuleSchema = z.object({
  pattern: z.string(),
  harness: HarnessIdSchema,
  description: z.string().optional(),
});
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const SessionPolicyGovernanceSchema = z.object({
  requireGitSnapshotOnHandoff: z.boolean().default(true),
  maxHandoffTokens: z.number().int().positive().default(8000),
  maxTranscriptLines: z.number().int().positive().default(200),
});
export type SessionPolicyGovernance = z.infer<typeof SessionPolicyGovernanceSchema>;

export const SessionPolicyVerificationSchema = z.object({
  /** When true (default), run test gate before follow-up waves when a command is resolved. */
  enableTestGate: z.boolean().default(true),
  /** Explicit test command; null disables auto-detection. */
  testCommand: z.string().nullable().optional(),
});
export type SessionPolicyVerification = z.infer<typeof SessionPolicyVerificationSchema>;

export const SessionPolicySchema = z.object({
  routing: z.array(RoutingRuleSchema),
  failover: z.array(HarnessIdSchema).min(1),
  governance: SessionPolicyGovernanceSchema.optional(),
  verification: SessionPolicyVerificationSchema.optional(),
});
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export function resolveSessionPolicyGovernance(
  policy: SessionPolicy,
): SessionPolicyGovernance {
  return SessionPolicyGovernanceSchema.parse(policy.governance ?? {});
}

export function resolveSessionPolicyVerification(
  policy: SessionPolicy,
): SessionPolicyVerification {
  return SessionPolicyVerificationSchema.parse(policy.verification ?? {});
}
