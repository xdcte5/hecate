import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatRouteReason } from "./diagnostics.js";
import {
  inferTaskType,
  loadRoutingPriors,
  previewRoute,
  resolveBlendedHarness,
  summarizeLocalStats,
} from "./blended.js";
import { loadRelayConfig } from "@relay/registry";
import { resolveSessionPolicyRoutingConfig } from "@relay/schema";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../fixtures/minimal-relay",
);

describe("inferTaskType", () => {
  it("maps debug goals to fix", () => {
    expect(inferTaskType("fix React component")).toBe("fix");
  });

  it("maps test goals to test", () => {
    expect(inferTaskType("write unit tests")).toBe("test");
  });
});

describe("formatRouteReason", () => {
  it("formats blended breakdown", () => {
    expect(
      formatRouteReason({
        reason: "blended",
        blendScores: { local: 0.82, benchmark: 0.79, heuristic: 0.71 },
      }),
    ).toBe("blended (local:0.82 bench:0.79 heur:0.71)");
  });
});

describe("blended routing integration", () => {
  it("loads fixture priors", async () => {
    const priors = await loadRoutingPriors(fixtureRoot);
    expect(priors?.task_types.fix?.["claude-code/claude-opus-4-6"]).toBe(0.9);
  });

  it("blends fix goals toward cursor with frontend signal adjustment", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const routingConfig = resolveSessionPolicyRoutingConfig(sessionPolicy);
    const priors = await loadRoutingPriors(fixtureRoot);

    const route = resolveBlendedHarness(
      "fix React component",
      registry,
      sessionPolicy,
      routingConfig,
      priors,
      [],
    );

    expect(route.harness).toBe("cursor");
    expect(route.reason).toBe("blended");
    expect(route.blendScores?.benchmark).toBeGreaterThan(0);
    expect(formatRouteReason(route)).toContain("blended (local:");
  });

  it("summarizes local stats by success rate", () => {
    const combos = summarizeLocalStats([
      {
        ts: "2026-07-14T10:00:00.000Z",
        sessionId: "s1",
        stepId: "step_1",
        taskType: "fix",
        task: "fix bug",
        harness: "cursor",
        model: "composer-2",
        ok: true,
      },
      {
        ts: "2026-07-14T10:05:00.000Z",
        sessionId: "s1",
        stepId: "step_2",
        taskType: "fix",
        task: "fix bug",
        harness: "cursor",
        model: "composer-2",
        ok: false,
      },
      {
        ts: "2026-07-14T10:10:00.000Z",
        sessionId: "s1",
        stepId: "step_3",
        taskType: "fix",
        task: "fix bug",
        harness: "codex",
        ok: true,
      },
    ]);

    expect(combos[0]?.key).toBe("codex");
    expect(combos[0]?.successes).toBe(1);
    expect(combos[0]?.total).toBe(1);
    expect(combos.find((combo) => combo.key === "cursor/composer-2")).toMatchObject({
      successes: 1,
      total: 2,
    });
  });

  it("previews route from fixture config", async () => {
    const route = await previewRoute(fixtureRoot, "write unit tests");
    expect(route.harness).toBe("codex");
    expect(["blended", "ability-match", "benchmark"]).toContain(route.reason);
  });

  it("uses local stats when enough samples exist", async () => {
    const stats = Array.from({ length: 5 }, (_, index) => ({
      ts: `2026-07-14T10:0${index}:00.000Z`,
      sessionId: "sess_local",
      stepId: `step_${index}`,
      taskType: "fix",
      task: "fix React component",
      harness: "cursor" as const,
      model: "composer-2",
      ok: true,
    }));

    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const route = resolveBlendedHarness(
      "fix React component",
      registry,
      sessionPolicy,
      resolveSessionPolicyRoutingConfig(sessionPolicy),
      await loadRoutingPriors(fixtureRoot),
      stats,
    );

    expect(route.blendScores?.local).toBe(1);
  });
});
