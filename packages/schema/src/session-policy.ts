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

export const SessionPolicySchema = z.object({
  routing: z.array(RoutingRuleSchema),
  failover: z.array(HarnessIdSchema).min(1),
  governance: SessionPolicyGovernanceSchema.optional(),
});
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export function resolveSessionPolicyGovernance(
  policy: SessionPolicy,
): SessionPolicyGovernance {
  return SessionPolicyGovernanceSchema.parse(policy.governance ?? {});
}
