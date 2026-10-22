import { z } from "zod";

/** Scores keyed by harness/model spec (e.g. `codex/o4-mini`, `pi/openai-codex/gpt-5.4`). */
export const HarnessModelScoreMapSchema = z.record(
  z.string(),
  z.number().min(0).max(1),
);
export type HarnessModelScoreMap = z.infer<typeof HarnessModelScoreMapSchema>;

/** Optional per-signal boost applied to a harness or harness/model target. */
export const SignalAdjustmentSchema = z.object({
  signal: z.string(),
  adjustment: z.number(),
  target: z.string(),
});
export type SignalAdjustment = z.infer<typeof SignalAdjustmentSchema>;

/** Prior success rates for blended routing, loaded from `relay/routing-priors.yaml`. */
export const RoutingPriorsSchema = z.object({
  version: z.string(),
  updated: z.string().optional(),
  sources: z.array(z.string()).optional(),
  task_types: z.record(z.string(), HarnessModelScoreMapSchema),
  signal_adjustments: z.array(SignalAdjustmentSchema).optional(),
});
export type RoutingPriors = z.infer<typeof RoutingPriorsSchema>;
