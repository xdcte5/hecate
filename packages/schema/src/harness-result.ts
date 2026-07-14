import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";
import { DecisionSchema } from "./rhp-v1.js";

export const HarnessResultSchema = z.object({
  ok: z.boolean(),
  harness: HarnessIdSchema,
  model: z.string().optional(),
  summary: z.string(),
  filesTouched: z.array(z.string()).optional(),
  decisions: z.array(DecisionSchema).optional(),
  error: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
});
export type HarnessResult = z.infer<typeof HarnessResultSchema>;
