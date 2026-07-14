import { describe, expect, it } from "vitest";
import { HarnessEventSchema, type HarnessEvent } from "./harness-event.js";

const at = "2026-07-14T09:00:00.000Z";

const fixtures: HarnessEvent[] = [
  {
    type: "step_start",
    at,
    stepId: "step_1",
    harness: "pi",
    task: "Scaffold login form",
    wave: 0,
    stepIndex: 0,
    totalSteps: 2,
  },
  {
    type: "step_end",
    at,
    stepId: "step_1",
    harness: "pi",
    ok: true,
    summary: "Pi finished.",
  },
  {
    type: "tool_start",
    at,
    toolName: "read",
    toolCallId: "tc_1",
    args: { path: "src/app/page.tsx" },
  },
  {
    type: "tool_end",
    at,
    toolName: "read",
    toolCallId: "tc_1",
    ok: true,
    output: "142 lines",
  },
  {
    type: "agent_message",
    at,
    role: "assistant",
    text: "I'll add a login form component.",
    delta: true,
  },
  {
    type: "plan",
    at,
    steps: [
      { id: "step_1", task: "Implement", harness: "pi", wave: 0 },
      { id: "step_2", task: "Test", harness: "codex", wave: 1 },
    ],
  },
  { type: "error", at, message: "Pi RPC failed", code: "rpc_error" },
  { type: "agent_start", at, harness: "pi" },
  { type: "agent_end", at, harness: "pi" },
  { type: "handoff", at, from: "pi", to: "codex", handoffSeq: 1 },
  { type: "retry_start", at, reason: "rate limit" },
  { type: "retry_end", at, ok: true },
];

describe("HarnessEventSchema", () => {
  it.each(fixtures)("parses %s events", (event) => {
    expect(HarnessEventSchema.parse(event)).toEqual(event);
  });

  it("rejects events with unknown type", () => {
    expect(() =>
      HarnessEventSchema.parse({ type: "step_done", at, stepId: "step_1" }),
    ).toThrow();
  });

  it("rejects tool_end without ok", () => {
    expect(() =>
      HarnessEventSchema.parse({
        type: "tool_end",
        at,
        toolName: "bash",
      }),
    ).toThrow();
  });

  it("rejects plan steps with invalid harness", () => {
    expect(() =>
      HarnessEventSchema.parse({
        type: "plan",
        at,
        steps: [{ id: "s1", task: "x", harness: "unknown", wave: 0 }],
      }),
    ).toThrow();
  });
});
