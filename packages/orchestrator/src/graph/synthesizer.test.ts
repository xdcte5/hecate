import { describe, expect, it } from "vitest";
import { synthesizeVerifierResults } from "./synthesizer.js";
import type { GraphNodeResult } from "./types.js";

function result(overrides: Partial<GraphNodeResult> = {}): GraphNodeResult {
  return {
    nodeId: "verifier-0",
    nodeType: "verifier",
    ok: true,
    verifier: {
      verifierId: "artifact",
      status: "PASS",
      ok: true,
      confidence: 1,
      evidence: "hello.sh exists",
      durationMs: 2,
    },
    durationMs: 2,
    ...overrides,
  };
}

describe("synthesizeVerifierResults", () => {
  it("acts when the graph has no verifier nodes", () => {
    const verdict = synthesizeVerifierResults([], 4);

    expect(verdict).toMatchObject({
      ok: true,
      recommendation: "ACT",
      confidence: 1,
      evidence: "no graph verifier nodes configured",
      verifierId: "graph",
      durationMs: 4,
      results: [],
    });
  });

  it("acts when all verifier nodes pass", () => {
    const verdict = synthesizeVerifierResults([
      result(),
      result({
        nodeId: "verifier-1",
        verifier: {
          verifierId: "python",
          status: "PASS",
          ok: true,
          confidence: 0.95,
          evidence: "python assertion passed",
          durationMs: 12,
        },
        durationMs: 12,
      }),
    ], 14);

    expect(verdict.ok).toBe(true);
    expect(verdict.recommendation).toBe("ACT");
    expect(verdict.confidence).toBe(0.95);
    expect(verdict.evidence).toContain("hello.sh exists");
    expect(verdict.evidence).toContain("python assertion passed");
    expect(verdict.results).toHaveLength(2);
  });

  it("blocks when any verifier node fails", () => {
    const verdict = synthesizeVerifierResults([
      result(),
      result({
        nodeId: "verifier-1",
        ok: false,
        verifier: {
          verifierId: "shell",
          status: "FAIL",
          ok: false,
          confidence: 0.9,
          evidence: "stdout mismatch",
          durationMs: 9,
        },
        durationMs: 9,
      }),
    ], 11);

    expect(verdict.ok).toBe(false);
    expect(verdict.recommendation).toBe("BLOCK");
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.evidence).toBe("stdout mismatch");
    expect(verdict.results.map((item) => item.verifierId)).toEqual(["artifact", "shell"]);
  });
});
