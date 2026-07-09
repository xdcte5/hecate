import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import { buildRunPlan } from "./plan.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

describe("buildRunPlan", () => {
  it("routes login page work through implement + test steps", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("add user login page", router);

    expect(plan.steps[0]).toMatchObject({
      id: "implement",
      harness: "cursor",
      reason: "failover",
    });
    expect(plan.steps[1]).toMatchObject({
      id: "test",
      harness: "codex",
      reason: "routing-rule",
    });
  });

  it("routes react work to cursor without redundant test harness", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("fix React component rendering", router);

    expect(plan.steps[0]?.harness).toBe("cursor");
    expect(plan.steps.some((step) => step.id === "test")).toBe(true);
  });
});
