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
  it("routes login page to a single implement step (no auto tests)", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("add user login page", router);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "implement",
      harness: "cursor",
      reason: "ability-match",
      wave: 0,
    });
  });

  it("adds a test step only when the user asks for tests", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("add user login page with unit tests", router);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]).toMatchObject({
      id: "test",
      harness: "codex",
      wave: 1,
    });
  });

  it("routes portfolio UI work to cursor in a single step", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan(
      "build a portfolio page with graph ui showing socials",
      router,
    );

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "implement",
      harness: "cursor",
      reason: "ability-match",
      model: "composer-2",
      modelReason: "ability-match",
      wave: 0,
    });
  });

  it("routes fix/debug goals to a single fix step", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("fix React component rendering", router);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "fix",
      harness: "cursor",
      reason: "ability-match",
    });
    expect(plan.steps.some((step) => step.id === "test")).toBe(false);
  });

  it("splits frontend+backend goals into parallel wave 0", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan(
      "build login page with JWT auth API and database backend",
      router,
    );

    const wave0 = plan.steps.filter((step) => step.wave === 0);
    expect(wave0).toHaveLength(2);
    expect(wave0.map((step) => step.id)).toEqual(
      expect.arrayContaining(["implement-frontend", "implement-backend"]),
    );
  });

  it("plans implement parallel wave then codex test when auth and tests requested", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("build portfolio site with auth and tests", router);

    const wave0 = plan.steps.filter((step) => step.wave === 0);
    expect(wave0).toHaveLength(2);
    expect(plan.steps.some((step) => step.id === "test" && step.harness === "codex")).toBe(true);
  });
});
