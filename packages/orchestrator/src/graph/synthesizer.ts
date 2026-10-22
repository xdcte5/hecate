import type { GateVerdict, VerifierResult } from "../verifiers/types.js";
import type { GraphNodeResult } from "./types.js";

function verifierResults(results: GraphNodeResult[]): VerifierResult[] {
  return results.flatMap((result) => (result.verifier ? [result.verifier] : []));
}

export function synthesizeVerifierResults(
  nodeResults: GraphNodeResult[],
  durationMs: number,
): GateVerdict {
  const results = verifierResults(nodeResults);
  if (results.length === 0) {
    return {
      ok: true,
      recommendation: "ACT",
      confidence: 1,
      evidence: "no graph verifier nodes configured",
      verifierId: "graph",
      durationMs,
      results,
    };
  }

  const failed = results.filter((result) => !result.ok);
  const ok = failed.length === 0;
  const relevant = ok ? results : failed;

  return {
    ok,
    recommendation: ok ? "ACT" : "BLOCK",
    confidence: ok
      ? Math.min(...results.map((result) => result.confidence))
      : Math.max(...failed.map((result) => result.confidence)),
    evidence: relevant.map((result) => result.evidence).join("; "),
    verifierId: "graph",
    durationMs,
    results,
  };
}
