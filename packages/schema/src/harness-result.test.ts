import { describe, expect, it } from "vitest";
import { HarnessResultSchema, type HarnessResult } from "./harness-result.js";

const successFixture: HarnessResult = {
  ok: true,
  harness: "pi",
  model: "claude-sonnet-4",
  summary: "Implemented login form and tests.",
  filesTouched: ["src/components/LoginForm.tsx", "src/app/page.tsx"],
  decisions: [
    {
      id: "dec_1",
      at: "2026-07-14T09:00:00.000Z",
      text: "Use React Hook Form for validation",
      rationale: "Matches existing project patterns",
    },
  ],
  durationMs: 42_500,
  toolCallCount: 12,
  inputTokens: 12_450,
  outputTokens: 890,
  costUsd: 0.0342,
};

const failureFixture: HarnessResult = {
  ok: false,
  harness: "codex",
  summary: "Pi timed out after 900s",
  error: "timeout",
};

describe("HarnessResultSchema", () => {
  it("parses a successful harness result", () => {
    expect(HarnessResultSchema.parse(successFixture)).toEqual(successFixture);
  });

  it("parses a minimal failure result", () => {
    expect(HarnessResultSchema.parse(failureFixture)).toEqual(failureFixture);
  });

  it("rejects unknown harness ids", () => {
    expect(() =>
      HarnessResultSchema.parse({ ...successFixture, harness: "kiro" }),
    ).toThrow();
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      HarnessResultSchema.parse({ ...successFixture, durationMs: -1 }),
    ).toThrow();
  });

  it("rejects negative toolCallCount", () => {
    expect(() =>
      HarnessResultSchema.parse({ ...successFixture, toolCallCount: -1 }),
    ).toThrow();
  });

  it("parses optional usage fields", () => {
    const withUsage = {
      ...successFixture,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
    };
    expect(HarnessResultSchema.parse(withUsage)).toEqual(withUsage);
  });

  it("rejects negative inputTokens", () => {
    expect(() =>
      HarnessResultSchema.parse({ ...successFixture, inputTokens: -1 }),
    ).toThrow();
  });

  it("rejects negative costUsd", () => {
    expect(() =>
      HarnessResultSchema.parse({ ...successFixture, costUsd: -0.01 }),
    ).toThrow();
  });
});
