import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import type { HarnessId, SessionPolicy } from "@relay/schema";
import { buildRunPlan } from "./plan.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

describe("buildRunPlan", () => {
  it("routes greetings to chat instead of implement", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("hi", router);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "chat",
      task: "hi",
      wave: 0,
    });
  });

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

  it("plans a single implement step for trivial hello.sh goals", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("Create hello.sh printing hello", router, sessionPolicy);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "implement",
      wave: 0,
    });
    expect(plan.steps.some((step) => step.id === "test")).toBe(false);
    expect(plan.steps.some((step) => step.id === "review")).toBe(false);
    expect(plan.steps[0]?.verify).toEqual([
      { type: "artifact", path: "hello.sh" },
      { type: "shell", command: "bash hello.sh", expectStdout: "hello\n" },
    ]);
  });

  it("attaches the documented fib.py micro-bench verifier", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan(
      "Create fib.py with function fib(n) returning nth Fibonacci (fib(0)=0,fib(1)=1). No external deps.",
      router,
      sessionPolicy,
    );

    expect(plan.steps[0]?.verify).toEqual([
      { type: "python", code: "from fib import fib; assert fib(10) == 55" },
    ]);
  });

  it("plans implement + test without review when tests requested but no review signals", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan("add API endpoint with tests", router, sessionPolicy);

    expect(plan.steps.map((step) => step.id)).toEqual(["implement", "test"]);
    expect(plan.steps.some((step) => step.id === "review")).toBe(false);
  });

  it("applies step_routing prefer list when building plan steps", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const policyWithRouting: SessionPolicy = {
      ...sessionPolicy,
      step_routing: {
        implement: { prefer: ["claude-code", "codex", "pi"] satisfies HarnessId[] },
        test: { prefer: ["codex", "claude-code"] satisfies HarnessId[] },
        review: { prefer: ["claude-code"], model_tier: "capable" },
      },
    };
    const router = new ThinRouter(registry, policyWithRouting);
    const plan = buildRunPlan("add user login page with unit tests", router, policyWithRouting);

    expect(plan.steps[0]?.harness).toBe("claude-code");
    expect(plan.steps[1]?.harness).toBe("codex");
  });

  it("review step prefers claude-code even when failover lists pi first", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const policyWithRouting: SessionPolicy = {
      ...sessionPolicy,
      failover: ["pi", "cursor", "codex", "claude-code"],
      routing_config: {
        mode: "benchmark",
        min_local_samples: 5,
        min_success_rate: 0.3,
        blend: { local: 0.5, benchmark: 0.25, heuristic: 0.25, cost: 0.15 },
      },
      step_routing: {
        review: { prefer: ["claude-code"], model_tier: "capable" },
      },
    };
    const router = new ThinRouter(registry, policyWithRouting, {}, fixtureRoot);
    const plan = buildRunPlan("build API with security review", router, policyWithRouting);

    const reviewStep = plan.steps.find((step) => step.id === "review");
    expect(reviewStep?.harness).toBe("claude-code");
  });

  it("applies model_tier capable for review steps", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const policyWithRouting: SessionPolicy = {
      ...sessionPolicy,
      routing_config: { mode: "heuristic", min_local_samples: 5, min_success_rate: 0.3, blend: { local: 0.5, benchmark: 0.25, heuristic: 0.25, cost: 0.15 } },
      step_routing: {
        review: { prefer: ["claude-code"], model_tier: "capable" },
      },
    };
    const router = new ThinRouter(registry, policyWithRouting);
    const plan = buildRunPlan("build API with security review", router, policyWithRouting);

    const reviewStep = plan.steps.find((step) => step.id === "review");
    expect(reviewStep).toMatchObject({
      harness: "claude-code",
      model: "claude-opus-4-6",
      modelTier: "capable",
    });
  });
});
