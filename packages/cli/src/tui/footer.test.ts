import { describe, expect, it } from "vitest";
import {
  createUsageTracker,
  formatCostUsd,
  formatTokenCount,
  renderFooter,
} from "./footer.js";

describe("renderFooter", () => {
  it("renders harness, model, step, and cwd", () => {
    const line = renderFooter({
      cwd: "/Users/dev/projects/sample-app",
      harness: "pi",
      model: "claude-sonnet-4-6",
      modelMode: "manual",
      step: 2,
      totalSteps: 3,
      width: 100,
    });

    expect(line).toContain("relay");
    expect(line).toContain("Pi");
    expect(line).toContain("claude-sonnet-4-6");
    expect(line).toContain("2/3");
    expect(line).toContain("sample-app");
  });

  it("shows auto model mode when unset", () => {
    const line = renderFooter({
      cwd: "/tmp/proj",
      harness: "codex",
      modelMode: "auto",
      width: 80,
    });

    expect(line).toContain("auto");
    expect(line).toContain("idle");
  });

  it("includes git branch and context percent when provided", () => {
    const line = renderFooter({
      cwd: "/tmp/proj",
      harness: "pi",
      gitBranch: "feat/tui",
      contextPct: 42,
      width: 100,
    });

    expect(line).toContain("feat/tui");
    expect(line).toContain("42%");
  });

  it("shows token and cost usage when provided", () => {
    const line = renderFooter({
      cwd: "/tmp/proj",
      harness: "pi",
      inputTokens: 12_450,
      outputTokens: 890,
      costUsd: 0.0342,
      width: 120,
    });

    expect(line).toContain("12k");
    expect(line).toContain("890");
    expect(line).toContain("$0.034");
  });
});

describe("formatTokenCount", () => {
  it("abbreviates large counts", () => {
    expect(formatTokenCount(890)).toBe("890");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12_450)).toBe("12k");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});

describe("formatCostUsd", () => {
  it("formats small and large costs", () => {
    expect(formatCostUsd(0.0025)).toBe("$0.0025");
    expect(formatCostUsd(0.0342)).toBe("$0.034");
    expect(formatCostUsd(1.25)).toBe("$1.25");
  });
});

describe("createUsageTracker", () => {
  it("accumulates usage across steps", () => {
    const tracker = createUsageTracker();
    tracker.onStepStart();
    expect(tracker.onUsage({ inputTokens: 100, outputTokens: 20, costUsd: 0.01 })).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    });
    expect(tracker.onStepEnd()).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    });

    tracker.onStepStart();
    expect(tracker.onUsage({ inputTokens: 50, outputTokens: 10, costUsd: 0.005 })).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      costUsd: 0.015,
    });
  });
});
