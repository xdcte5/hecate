import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

const eventTimestamp = z.string().datetime();

export const PlanStepEventSchema = z.object({
  id: z.string(),
  task: z.string(),
  harness: HarnessIdSchema,
  wave: z.number().int().nonnegative(),
});
export type PlanStepEvent = z.infer<typeof PlanStepEventSchema>;

export const StepStartEventSchema = z.object({
  type: z.literal("step_start"),
  at: eventTimestamp,
  stepId: z.string(),
  harness: HarnessIdSchema,
  task: z.string(),
  wave: z.number().int().nonnegative().optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().positive().optional(),
});
export type StepStartEvent = z.infer<typeof StepStartEventSchema>;

export const StepEndEventSchema = z.object({
  type: z.literal("step_end"),
  at: eventTimestamp,
  stepId: z.string(),
  harness: HarnessIdSchema,
  ok: z.boolean(),
  summary: z.string().optional(),
});
export type StepEndEvent = z.infer<typeof StepEndEventSchema>;

export const ToolStartEventSchema = z.object({
  type: z.literal("tool_start"),
  at: eventTimestamp,
  toolName: z.string(),
  toolCallId: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ToolStartEvent = z.infer<typeof ToolStartEventSchema>;

export const ToolEndEventSchema = z.object({
  type: z.literal("tool_end"),
  at: eventTimestamp,
  toolName: z.string(),
  toolCallId: z.string().optional(),
  ok: z.boolean(),
  output: z.string().optional(),
});
export type ToolEndEvent = z.infer<typeof ToolEndEventSchema>;

export const AgentMessageEventSchema = z.object({
  type: z.literal("agent_message"),
  at: eventTimestamp,
  role: z.enum(["assistant", "user", "system"]),
  text: z.string(),
  delta: z.boolean().optional(),
});
export type AgentMessageEvent = z.infer<typeof AgentMessageEventSchema>;

export const PlanEventSchema = z.object({
  type: z.literal("plan"),
  at: eventTimestamp,
  steps: z.array(PlanStepEventSchema),
});
export type PlanEvent = z.infer<typeof PlanEventSchema>;

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  at: eventTimestamp,
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const AgentStartEventSchema = z.object({
  type: z.literal("agent_start"),
  at: eventTimestamp,
  harness: HarnessIdSchema.optional(),
});
export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;

export const AgentEndEventSchema = z.object({
  type: z.literal("agent_end"),
  at: eventTimestamp,
  harness: HarnessIdSchema.optional(),
});
export type AgentEndEvent = z.infer<typeof AgentEndEventSchema>;

export const HandoffEventSchema = z.object({
  type: z.literal("handoff"),
  at: eventTimestamp,
  to: HarnessIdSchema,
  from: HarnessIdSchema.optional(),
  handoffSeq: z.number().int().nonnegative().optional(),
});
export type HandoffEvent = z.infer<typeof HandoffEventSchema>;

export const RetryStartEventSchema = z.object({
  type: z.literal("retry_start"),
  at: eventTimestamp,
  reason: z.string().optional(),
});
export type RetryStartEvent = z.infer<typeof RetryStartEventSchema>;

export const RetryEndEventSchema = z.object({
  type: z.literal("retry_end"),
  at: eventTimestamp,
  ok: z.boolean().optional(),
});
export type RetryEndEvent = z.infer<typeof RetryEndEventSchema>;

export const HarnessEventSchema = z.discriminatedUnion("type", [
  StepStartEventSchema,
  StepEndEventSchema,
  ToolStartEventSchema,
  ToolEndEventSchema,
  AgentMessageEventSchema,
  PlanEventSchema,
  ErrorEventSchema,
  AgentStartEventSchema,
  AgentEndEventSchema,
  HandoffEventSchema,
  RetryStartEventSchema,
  RetryEndEventSchema,
]);
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;
