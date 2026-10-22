import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

/** One step outcome record for blended routing feedback loops. */
export const RoutingOutcomeSchema = z.object({
  ts: z.string(),
  sessionId: z.string(),
  stepId: z.string(),
  taskType: z.string(),
  task: z.string(),
  harness: HarnessIdSchema,
  model: z.string().optional(),
  ok: z.boolean(),
  verifyOk: z.boolean().optional(),
  filesChanged: z.number().int().nonnegative().optional(),
  testsPassed: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  failoverUsed: z.boolean().optional(),
  failoverReason: z.enum(["auth", "capability", "verify", "none"]).optional(),
  reason: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type RoutingOutcome = z.infer<typeof RoutingOutcomeSchema>;
