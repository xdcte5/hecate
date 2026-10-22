import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const RoutingRuleSchema = z.object({
  pattern: z.string(),
  harness: HarnessIdSchema,
  description: z.string().optional(),
});
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

/** Blend weights for auto mode (local history, benchmark priors, heuristic router). */
export const RoutingBlendSchema = z.object({
  local: z.number().min(0).max(1).default(0.425),
  benchmark: z.number().min(0).max(1).default(0.2125),
  heuristic: z.number().min(0).max(1).default(0.2125),
  cost: z.number().min(0).max(1).default(0.15),
});
export type RoutingBlend = z.infer<typeof RoutingBlendSchema>;

/**
 * Blended routing configuration. Explicit `routing[]` overrides in session-policy
 * always win over auto/heuristic/benchmark selection — overrides are checked first.
 */
export const RoutingConfigSchema = z.object({
  mode: z.enum(["auto", "heuristic", "benchmark"]).default("auto"),
  min_local_samples: z.number().int().positive().default(5),
  /** Exclude harnesses with local success rate below this once min_local_samples is met. */
  min_success_rate: z.number().min(0).max(1).default(0.3),
  blend: RoutingBlendSchema.default({
    local: 0.425,
    benchmark: 0.2125,
    heuristic: 0.2125,
    cost: 0.15,
  }),
});
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;

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
  /** Per-step verifier retry budget before failing the run. */
  maxStepRetries: z.number().int().nonnegative().default(3),
});
export type SessionPolicyVerification = z.infer<typeof SessionPolicyVerificationSchema>;

/** Per-step-type harness preference (checked before global failover). */
export const StepRoutingRuleSchema = z.object({
  prefer: z.array(HarnessIdSchema).min(1),
  model_tier: z.enum(["capable"]).optional(),
});
export type StepRoutingRule = z.infer<typeof StepRoutingRuleSchema>;

export const StepRoutingSchema = z.object({
  implement: StepRoutingRuleSchema.optional(),
  test: StepRoutingRuleSchema.optional(),
  review: StepRoutingRuleSchema.optional(),
  debug: StepRoutingRuleSchema.optional(),
});
export type StepRouting = z.infer<typeof StepRoutingSchema>;

export const SessionPolicySchema = z.object({
  routing: z.array(RoutingRuleSchema),
  failover: z.array(HarnessIdSchema).min(1),
  routing_config: RoutingConfigSchema.optional(),
  step_routing: StepRoutingSchema.optional(),
  governance: SessionPolicyGovernanceSchema.optional(),
  verification: SessionPolicyVerificationSchema.optional(),
});
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export function resolveSessionPolicyRoutingConfig(
  policy: SessionPolicy,
): RoutingConfig {
  return RoutingConfigSchema.parse(policy.routing_config ?? {});
}

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

export function resolveSessionPolicyStepRouting(
  policy: SessionPolicy,
): StepRouting | undefined {
  if (!policy.step_routing) return undefined;
  return StepRoutingSchema.parse(policy.step_routing);
}
