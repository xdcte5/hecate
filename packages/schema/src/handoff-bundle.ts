import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";
import { DecisionSchema, GitSnapshotSchema, TodoSchema } from "./rhp-v1.js";

export const HandoffBundleSchema = z.object({
  rhp_version: z.literal("1"),
  sessionId: z.string(),
  targetHarness: HarnessIdSchema,
  sourceHarness: HarnessIdSchema.optional(),
  handoffSeq: z.number().int().nonnegative(),
  prepared_at: z.string().datetime(),
  goal: z.string(),
  decisions: z.array(DecisionSchema),
  todos: z.array(TodoSchema),
  git: GitSnapshotSchema.optional(),
});
export type HandoffBundle = z.infer<typeof HandoffBundleSchema>;
