import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  aggregateMedianCosts,
  aggregateSuccessRates,
  computePriorDrift,
  formatPriorDriftReport,
  getHarnessLocalStats,
  getLocalCostMedian,
  getLocalScore,
  isHarnessExcludedByConfidence,
  readRoutingStats,
} from "./routing-stats-reader.js";

async function writeStatsFixture(lines: string[]) {
  const dir = join(tmpdir(), `relay-stats-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, ".relay"), { recursive: true });
  await writeFile(join(dir, ".relay", "routing-stats.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return dir;
}

const baseOutcome = {
  ts: "2026-07-14T00:00:00.000Z",
  sessionId: "s1",
  stepId: "step-1",
  task: "write unit tests",
};

describe("readRoutingStats", () => {
  it("returns empty array on cold start", async () => {
    const dir = join(tmpdir(), `relay-stats-missing-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await expect(readRoutingStats(dir)).resolves.toEqual([]);
  });

  it("parses jsonl outcomes", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        model: "o4-mini",
        ok: true,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        model: "o4-mini",
        ok: false,
      }),
    ]);

    const stats = await readRoutingStats(cwd);
    expect(stats).toHaveLength(2);
    expect(stats[0]?.ok).toBe(true);
  });
});

describe("aggregateSuccessRates", () => {
  it("aggregates by taskType:harness:model", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: false }),
      JSON.stringify({ ...baseOutcome, taskType: "implement", harness: "pi", model: "gpt-4o", ok: true }),
    ]);

    const stats = await readRoutingStats(cwd);
    const aggregates = aggregateSuccessRates(stats, 3);

    expect(aggregates.get("test:codex:o4-mini")).toEqual({ rate: 2 / 3, count: 3 });
    expect(aggregates.get("implement:pi:gpt-4o")).toEqual({ rate: 1, count: 1 });
  });
});

describe("getLocalScore", () => {
  it("returns null until minSamples is met", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: false }),
    ]);

    const stats = await readRoutingStats(cwd);
    const aggregates = aggregateSuccessRates(stats, 5);

    expect(getLocalScore(aggregates, "test", "codex", "o4-mini", 5)).toBeNull();
    expect(getLocalScore(aggregates, "test", "codex", "o4-mini", 2)).toBe(0.5);
  });
});

describe("aggregateMedianCosts", () => {
  it("computes median cost per taskType:harness for verified successes", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: true,
        costUsd: 0.1,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: true,
        costUsd: 0.3,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: true,
        costUsd: 0.5,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: false,
        costUsd: 0.01,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "pi",
        ok: true,
        verifyOk: true,
        costUsd: 0.05,
      }),
    ]);

    const stats = await readRoutingStats(cwd);
    const aggregates = aggregateMedianCosts(stats, 3);

    expect(aggregates.get("test:codex")).toEqual({ median: 0.3, count: 3 });
    expect(aggregates.get("test:pi")).toEqual({ median: 0.05, count: 1 });
  });
});

describe("getLocalCostMedian", () => {
  it("returns null until minSamples is met", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: true,
        costUsd: 0.1,
      }),
      JSON.stringify({
        ...baseOutcome,
        taskType: "test",
        harness: "codex",
        ok: true,
        verifyOk: true,
        costUsd: 0.2,
      }),
    ]);

    const stats = await readRoutingStats(cwd);
    const aggregates = aggregateMedianCosts(stats, 3);

    expect(getLocalCostMedian(aggregates, "test", "codex", 3)).toBeNull();
    expect(getLocalCostMedian(aggregates, "test", "codex", 2)).toBeCloseTo(0.15);
  });
});

describe("getHarnessLocalStats", () => {
  it("aggregates harness-level success for a task type", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: true }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
    ]);

    const stats = await readRoutingStats(cwd);
    expect(getHarnessLocalStats(stats, "test", "codex")).toEqual({
      count: 3,
      rate: 2 / 3,
    });
  });
});

describe("isHarnessExcludedByConfidence", () => {
  it("excludes only when enough samples and rate is below threshold", async () => {
    const cwd = await writeStatsFixture([
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
      JSON.stringify({ ...baseOutcome, taskType: "test", harness: "pi", ok: true }),
    ]);

    const stats = await readRoutingStats(cwd);
    expect(isHarnessExcludedByConfidence(stats, "test", "codex", 3, 0.3)).toBe(true);
    expect(isHarnessExcludedByConfidence(stats, "test", "pi", 3, 0.3)).toBe(false);
    expect(isHarnessExcludedByConfidence(stats, "test", "codex", 5, 0.3)).toBe(false);
  });
});

describe("computePriorDrift", () => {
  it("reports success and cost drift against priors", () => {
    const stats = [
      {
        ...baseOutcome,
        taskType: "test",
        harness: "codex" as const,
        ok: true,
        verifyOk: true,
        costUsd: 0.2,
      },
      {
        ...baseOutcome,
        taskType: "test",
        harness: "codex" as const,
        ok: false,
        verifyOk: false,
        costUsd: 0.1,
      },
    ];

    const rows = computePriorDrift(stats, {
      task_types: { test: { codex: 0.9 } },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        taskType: "test",
        harness: "codex",
        samples: 2,
        actualSuccess: 0.5,
        priorSuccess: 0.9,
        successDrift: -0.4,
        actualCostMedian: 0.2,
        samplesWithCost: 1,
      }),
    ]);
  });
});

describe("formatPriorDriftReport", () => {
  it("renders a RouterBench-style table", () => {
    const report = formatPriorDriftReport([
      {
        taskType: "implement",
        harness: "claude-code",
        samples: 3,
        actualSuccess: 1,
        priorSuccess: 0.68,
        successDrift: 0.32,
        actualCostMedian: 0.09,
        samplesWithCost: 3,
      },
    ]);

    expect(report).toContain("implement");
    expect(report).toContain("claude-code");
    expect(report).toContain("+0.32");
    expect(report).toContain("$0.0900");
  });
});
