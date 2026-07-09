import { describe, expect, it } from "vitest";
import { analyzeGoal } from "./goal-analysis.js";

describe("analyzeGoal", () => {
  it("treats UI builds as single implement work", () => {
    const analysis = analyzeGoal("build a portfolio page with graph ui");
    expect(analysis.mode).toBe("build");
    expect(analysis.layers.frontend).toBe(true);
    expect(analysis.wantsTests).toBe(false);
  });

  it("detects explicit test requests", () => {
    const analysis = analyzeGoal("write unit tests for auth module");
    expect(analysis.mode).toBe("test");
    expect(analysis.wantsTests).toBe(true);
  });

  it("detects fix/debug without adding test intent", () => {
    const analysis = analyzeGoal("fix broken api handler");
    expect(analysis.mode).toBe("fix");
    expect(analysis.wantsTests).toBe(false);
  });

  it("detects full-stack layers", () => {
    const analysis = analyzeGoal("build login page with jwt api and database");
    expect(analysis.layers.frontend).toBe(true);
    expect(analysis.layers.backend).toBe(true);
  });
});
