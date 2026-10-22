import { describe, expect, it } from "vitest";
import { RoutingOutcomeSchema, type RoutingOutcome } from "./routing-outcome.js";

const baseFixture: RoutingOutcome = {
  ts: "2026-07-15T10:00:00.000Z",
  sessionId: "sess_1",
  stepId: "implement-1",
  taskType: "implement",
  task: "Create hello.sh",
  harness: "claude-code",
  model: "claude-sonnet-4",
  ok: true,
  verifyOk: true,
  filesChanged: 1,
  durationMs: 18_000,
  failoverUsed: false,
};

describe("RoutingOutcomeSchema", () => {
  it("parses a routing outcome with usage fields", () => {
    const withUsage = {
      ...baseFixture,
      inputTokens: 2048,
      outputTokens: 456,
      costUsd: 0.003412,
      failoverReason: "none" as const,
    };
    expect(RoutingOutcomeSchema.parse(withUsage)).toEqual(withUsage);
  });

  it("accepts failoverReason enum values", () => {
    for (const failoverReason of ["auth", "capability", "verify", "none"] as const) {
      expect(
        RoutingOutcomeSchema.parse({ ...baseFixture, failoverReason }),
      ).toMatchObject({ failoverReason });
    }
  });

  it("rejects invalid failoverReason", () => {
    expect(() =>
      RoutingOutcomeSchema.parse({ ...baseFixture, failoverReason: "retry" }),
    ).toThrow();
  });

  it("rejects negative token counts", () => {
    expect(() =>
      RoutingOutcomeSchema.parse({ ...baseFixture, inputTokens: -1 }),
    ).toThrow();
  });
});
