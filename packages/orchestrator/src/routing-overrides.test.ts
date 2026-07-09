import { describe, expect, it } from "vitest";
import { ThinRouter } from "@relay/registry";
import type { Registry, SessionPolicy } from "@relay/schema";
import { applyRoutingOverrides, buildRunPlan } from "./plan.js";

const registry: Registry = {
  harnesses: [
    { id: "claude-code", strengths: ["architecture"], weaknesses: [], binaries: ["claude"] },
    { id: "codex", strengths: ["unit tests"], weaknesses: [], binaries: ["codex"] },
    { id: "pi", strengths: ["implementation"], weaknesses: [], binaries: ["pi"] },
    { id: "cursor", strengths: ["react", "frontend"], weaknesses: [], binaries: ["cursor-agent"] },
  ],
};

const policy: SessionPolicy = {
  routing: [],
  failover: ["pi", "cursor", "claude-code", "codex"],
  governance: { requireGitSnapshotOnHandoff: false, maxHandoffTokens: 8000, maxTranscriptLines: 200 },
};

describe("applyRoutingOverrides", () => {
  const router = new ThinRouter(registry, policy);

  it("forces a harness for a step-kind and its variants", () => {
    const plan = buildRunPlan("build a react frontend and an api backend", router);
    const overridden = applyRoutingOverrides(plan, { implement: "pi" }, router);

    const implementSteps = overridden.steps.filter((s) => s.id.startsWith("implement"));
    expect(implementSteps.length).toBeGreaterThan(0);
    for (const step of implementSteps) {
      expect(step.harness).toBe("pi");
    }
  });

  it("is a no-op when no overrides are given", () => {
    const plan = buildRunPlan("write unit tests for the parser", router);
    expect(applyRoutingOverrides(plan, undefined, router)).toEqual(plan);
    expect(applyRoutingOverrides(plan, {}, router)).toEqual(plan);
  });
});
