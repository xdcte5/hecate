import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  parseReportedTokens,
  estimateCost,
  pctReduction,
  computeSavings,
  aggregate,
  buildReport,
  formatReportTable,
} from "./metrics.js";
import type { RunMetrics } from "./types.js";

function metrics(mode: RunMetrics["mode"], over: Partial<RunMetrics>): RunMetrics {
  return {
    mode,
    ok: true,
    agentInvocations: 1,
    plannerCalls: 0,
    outputChars: 0,
    lines: [],
    wallMs: 0,
    filesChanged: 0,
    changedFiles: [],
    estimatedTokens: 0,
    humanInterventions: 0,
    ...over,
  };
}

describe("token + cost estimation", () => {
  it("prefers reported tokens over the char proxy", () => {
    expect(estimateTokens(4000)).toBe(1000);
    expect(estimateTokens(4000, 250)).toBe(250);
  });

  it("scrapes token counts from output lines", () => {
    expect(parseReportedTokens(['{"output_tokens": 512}'])).toBe(512);
    expect(parseReportedTokens(["used 128 tokens", "tokens: 72"])).toBe(200);
    expect(parseReportedTokens(["no usage here"])).toBeUndefined();
  });

  it("estimates cost only when a default rate is given", () => {
    expect(estimateCost(2000, { default: 0.015 })).toBeCloseTo(0.03);
    expect(estimateCost(2000)).toBeUndefined();
  });
});

describe("savings", () => {
  it("computes percent reduction (positive = improvement)", () => {
    expect(pctReduction(100, 60)).toBe(40);
    expect(pctReduction(0, 10)).toBe(0);
  });

  it("compares two runs", () => {
    const b = metrics("baseline", { wallMs: 42_000, estimatedTokens: 1000, agentInvocations: 1 });
    const h = metrics("hecate", { wallMs: 29_000, estimatedTokens: 700, agentInvocations: 4 });
    const s = computeSavings(b, h);
    expect(s.wallPct).toBeCloseTo(31, 0);
    expect(s.tokenPct).toBe(30);
    expect(s.invocationsDelta).toBe(3);
  });
});

describe("aggregate + report", () => {
  it("sums runs and builds a comparison report with a table", () => {
    const comparisons = [
      {
        taskId: "t1",
        goal: "do a thing",
        baseline: metrics("baseline", { wallMs: 40_000, estimatedTokens: 1000, filesChanged: 3, verifyPassed: true }),
        hecate: metrics("hecate", { wallMs: 30_000, estimatedTokens: 600, agentInvocations: 4, filesChanged: 3, verifyPassed: true }),
        savings: { wallPct: 25, tokenPct: 40, invocationsDelta: 3 },
      },
    ];
    const report = buildReport(comparisons);
    expect(report.totals.baseline.estimatedTokens).toBe(1000);
    expect(report.totals.hecate.estimatedTokens).toBe(600);
    expect(report.totals.savings.tokenPct).toBe(40);

    const table = formatReportTable(report);
    expect(table).toContain("SAVINGS");
    expect(table).toContain("t1");
  });

  it("aggregates verify pass counts", () => {
    const agg = aggregate([
      metrics("hecate", { verifyPassed: true }),
      metrics("hecate", { verifyPassed: false }),
    ]);
    expect(agg.verifyPassed).toBe(1);
    expect(agg.runs).toBe(2);
  });
});
