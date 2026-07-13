import { describe, expect, it } from "vitest";
import type { Registry, SessionPolicy } from "@relay/schema";
import { assignStep, capabilityScore } from "./capability-router.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      planning: 9,
      strengths: ["architecture", "refactoring", "complex reasoning", "debugging"],
      weaknesses: ["unit tests"],
      binaries: ["claude"],
      models: [
        { id: "claude-opus-4-6", strengths: ["architecture", "refactoring"], weaknesses: [] },
        { id: "claude-sonnet-4-6", strengths: ["frontend", "implementation"], weaknesses: [] },
      ],
    },
    {
      id: "codex",
      strengths: ["unit tests", "test generation", "typescript", "api design"],
      weaknesses: ["ui work"],
      binaries: ["codex"],
      models: [{ id: "o4-mini", strengths: ["unit tests", "test generation"], weaknesses: [] }],
    },
    {
      id: "cursor",
      strengths: ["react", "frontend", "jsx", "ui"],
      weaknesses: ["deep architecture"],
      binaries: ["cursor-agent"],
      models: [{ id: "composer-2", strengths: ["react", "frontend", "ui"], weaknesses: [] }],
    },
    {
      id: "pi",
      capabilities: ["native-tool-loop", "extensions"],
      strengths: ["implementation", "greenfield", "scaffolding", "cli"],
      weaknesses: ["complex refactors"],
      binaries: ["pi"],
      models: [{ id: "gpt-4o", strengths: ["scripts", "cli"], weaknesses: [] }],
    },
  ],
};

const policy: SessionPolicy = {
  routing: [],
  failover: ["pi", "cursor", "claude-code", "codex"],
};

describe("capabilityScore", () => {
  it("rewards an explicit capability tag most, then strengths", () => {
    const pi = registry.harnesses.find((h) => h.id === "pi")!;
    expect(capabilityScore(pi, "native-tool-loop")).toBe(3);
    expect(capabilityScore(pi, "implementation")).toBe(2);
  });

  it("only the tag satisfies a special capability, never strengths", () => {
    const claude = registry.harnesses.find((h) => h.id === "claude-code")!;
    expect(capabilityScore(claude, "native-tool-loop")).toBe(0);
  });
});

describe("assignStep", () => {
  it("routes native-tool-loop work to Pi via capability match, not failover", () => {
    const a = assignStep({
      task: "run a long autonomous loop editing files",
      requiredCapabilities: ["native-tool-loop"],
      registry,
      policy,
    });
    expect(a.harness).toBe("pi");
    expect(a.harnessReason).toBe("capability-match");
    expect(a.matchedCapabilities).toContain("native-tool-loop");
  });

  it("routes frontend work to cursor", () => {
    const a = assignStep({
      task: "build a react component for the portfolio page",
      requiredCapabilities: ["frontend"],
      registry,
      policy,
    });
    expect(a.harness).toBe("cursor");
    expect(a.model).toBe("composer-2");
  });

  it("routes test work to codex", () => {
    const a = assignStep({
      task: "write unit tests with coverage",
      requiredCapabilities: ["testing"],
      registry,
      policy,
    });
    expect(a.harness).toBe("codex");
  });

  it("respects enabled-agent filtering", () => {
    const a = assignStep({
      task: "run a long autonomous loop",
      requiredCapabilities: ["native-tool-loop"],
      registry,
      policy,
      enabled: ["claude-code", "codex"],
    });
    // Pi is disabled; native-tool-loop can't be satisfied, so it does not pick Pi.
    expect(a.harness).not.toBe("pi");
    expect(["claude-code", "codex"]).toContain(a.harness);
  });
});
