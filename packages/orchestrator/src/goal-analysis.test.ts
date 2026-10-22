import { describe, expect, it } from "vitest";
import { analyzeGoal, classifyStepTask, isTrivialGoal } from "./goal-analysis.js";

describe("isTrivialGoal", () => {
  it("detects hello.sh and simple script goals", () => {
    expect(isTrivialGoal("Create hello.sh printing hello")).toBe(true);
    expect(isTrivialGoal("create a simple shell script for backups")).toBe(true);
    expect(isTrivialGoal("add deploy.sh")).toBe(true);
  });

  it("detects single-file fix and one-function goals", () => {
    expect(isTrivialGoal("fix typo in README.md")).toBe(true);
    expect(isTrivialGoal("add a function to parse dates")).toBe(true);
  });

  it("rejects goals with test or review signals", () => {
    expect(isTrivialGoal("create hello.sh with unit tests")).toBe(false);
    expect(isTrivialGoal("create hello.sh and review security")).toBe(false);
  });

  it("rejects full-stack or multi-layer goals", () => {
    expect(isTrivialGoal("build login page with jwt api")).toBe(false);
  });
});

describe("analyzeGoal", () => {
  it("detects conversational greetings", () => {
    const analysis = analyzeGoal("hi");
    expect(analysis.mode).toBe("chat");
    expect(analysis.wantsTests).toBe(false);
    expect(analysis.wantsReview).toBe(false);
  });

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

  it("detects security review intent", () => {
    const analysis = analyzeGoal("audit security of auth module");
    expect(analysis.wantsReview).toBe(true);
    expect(analysis.mode).toBe("review");
  });
});

describe("classifyStepTask", () => {
  it("uses step id when it is a known task type", () => {
    expect(classifyStepTask("implement-frontend", "anything")).toBe("implement-frontend");
    expect(classifyStepTask("test", "anything")).toBe("test");
    expect(classifyStepTask("fix", "anything")).toBe("fix");
  });

  it("infers task type from natural-language task text", () => {
    expect(classifyStepTask("custom", "hi")).toBe("chat");
    expect(classifyStepTask("custom", "write unit tests for auth module")).toBe("test");
    expect(classifyStepTask("custom", "fix broken api handler")).toBe("fix");
    expect(classifyStepTask("custom", "review architecture risks")).toBe("review");
    expect(classifyStepTask("custom", "refactor module layout")).toBe("refactor");
    expect(classifyStepTask("custom", "build portfolio page with graph ui")).toBe("implement-frontend");
    expect(classifyStepTask("custom", "build jwt api endpoint")).toBe("implement-backend");
    expect(classifyStepTask("custom", "build something vague")).toBe("implement");
  });
});
