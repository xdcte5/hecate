import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBenchmark, simulateRunners, type BenchRunners } from "./run.js";
import type { BenchSpec } from "./types.js";

const fixtureRoot = join(import.meta.dirname, "../../../../fixtures/minimal-relay");

const spec: BenchSpec = {
  tasks: [
    { id: "t1", goal: "build a thing" },
    { id: "t2", goal: "fix a thing" },
  ],
  costPer1kTokens: { default: 0.01 },
};

describe("runBenchmark", () => {
  it("runs each task in both modes with injected runners", async () => {
    const seen: string[] = [];
    const runners: BenchRunners = {
      async baseline(task) {
        seen.push(`baseline:${task.id}`);
        return { ok: true, agentInvocations: 1, plannerCalls: 0, outputChars: 4000, lines: [], wallMsOverride: 40_000 };
      },
      async hecate(task) {
        seen.push(`hecate:${task.id}`);
        return { ok: true, agentInvocations: 4, plannerCalls: 1, outputChars: 2400, lines: [], wallMsOverride: 28_000 };
      },
    };

    const report = await runBenchmark({ cwd: fixtureRoot, spec, runners, snapshotFiles: false });

    expect(seen).toEqual(["baseline:t1", "hecate:t1", "baseline:t2", "hecate:t2"]);
    expect(report.tasks).toHaveLength(2);
    // Hecate reuses context → fewer tokens, more calls.
    expect(report.totals.savings.tokenPct).toBe(40);
    expect(report.totals.savings.wallPct).toBe(30);
    expect(report.totals.savings.invocationsDelta).toBe(6); // (4-1) per task × 2
    expect(report.totals.baseline.estimatedCostUsd).toBeCloseTo(0.02); // 2000 tok × 2 runs @ .01/1k
  });

  it("runs end-to-end with the simulator and no agents", async () => {
    const report = await runBenchmark({
      cwd: fixtureRoot,
      spec,
      runners: simulateRunners(),
      snapshotFiles: false,
    });
    expect(report.tasks).toHaveLength(2);
    expect(report.totals.hecate.estimatedTokens).toBeLessThan(report.totals.baseline.estimatedTokens);
    expect(report.totals.savings.wallPct).toBeGreaterThan(0);
  });
});
