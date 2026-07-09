import { z } from "zod";
import { HarnessIdSchema, type HarnessId } from "./harness-id.js";

export const RhpStatusSchema = z.enum(["active", "paused", "completed", "failed"]);
export type RhpStatus = z.infer<typeof RhpStatusSchema>;

export const TodoStatusSchema = z.enum(["pending", "in_progress", "done"]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: TodoStatusSchema.default("pending"),
});
export type Todo = z.infer<typeof TodoSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  at: z.string().datetime(),
  text: z.string(),
  rationale: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const GitSnapshotSchema = z.object({
  remote: z.string(),
  branch: z.string(),
  head: z.string(),
  dirty_files: z.array(z.string()),
  staged_diff: z.string().optional(),
  unstaged_diff: z.string().optional(),
});
export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;

export const AgentRecordSchema = z.object({
  harness: HarnessIdSchema,
  lastActiveAt: z.string().datetime(),
  handoffCount: z.number().int().nonnegative().default(0),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

export const RhpV1Schema = z.object({
  rhp_version: z.literal("1"),
  sessionId: z.string(),
  goal: z.string(),
  status: RhpStatusSchema,
  updated_at: z.string().datetime(),
  activeHarness: HarnessIdSchema.optional(),
  decisions: z.array(DecisionSchema),
  todos: z.array(TodoSchema),
  git: GitSnapshotSchema.optional(),
  agents: z.record(z.string(), AgentRecordSchema),
  handoffSeq: z.number().int().nonnegative(),
});
export type RhpV1 = z.infer<typeof RhpV1Schema>;

export function emptyRhpV1(sessionId: string, goal: string, harness: HarnessId): RhpV1 {
  const now = new Date().toISOString();
  return {
    rhp_version: "1",
    sessionId,
    goal,
    status: "active",
    updated_at: now,
    activeHarness: harness,
    decisions: [],
    todos: [],
    agents: {
      [harness]: {
        harness,
        lastActiveAt: now,
        handoffCount: 0,
      },
    },
    handoffSeq: 0,
  };
}
