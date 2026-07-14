import { describe, expect, it } from "vitest";
import { applyFailoverRetry, suggestFailoverRetry } from "./replan.js";
import type { RunStep } from "./types.js";

describe("suggestFailoverRetry", () => {
  it("suggests the next failover harness after failure", () => {
    const suggestion = suggestFailoverRetry(
      { id: "implement", harness: "pi", task: "build login" },
      ["pi", "cursor", "claude-code", "codex"],
    );

    expect(suggestion).toEqual({
      harness: "cursor",
      message: 'Step "implement" failed on pi; retrying with cursor',
    });
  });

  it("returns null when already retried", () => {
    expect(
      suggestFailoverRetry(
        { id: "implement", harness: "pi", task: "build login" },
        ["pi", "cursor"],
        { alreadyRetried: true },
      ),
    ).toBeNull();
  });

  it("returns null when no alternate harness exists", () => {
    expect(
      suggestFailoverRetry(
        { id: "implement", harness: "pi", task: "build login" },
        ["pi"],
      ),
    ).toBeNull();
  });
});

describe("applyFailoverRetry", () => {
  it("resets step state for a failover harness", () => {
    const step: RunStep = {
      id: "implement",
      task: "build login",
      harness: "pi",
      reason: "ability-match",
      wave: 0,
      status: "failed",
      error: "Pi failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      result: { ok: false, harness: "pi", summary: "Pi failed" },
      binary: "pi",
    };

    applyFailoverRetry(step, "claude-code");

    expect(step.harness).toBe("claude-code");
    expect(step.reason).toBe("failover");
    expect(step.status).toBe("pending");
    expect(step.error).toBeUndefined();
    expect(step.startedAt).toBeUndefined();
    expect(step.finishedAt).toBeUndefined();
    expect(step.result).toBeUndefined();
    expect(step.binary).toBeUndefined();
  });
});
