import { describe, expect, it } from "vitest";
import { renderFooter } from "./footer.js";

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
});
