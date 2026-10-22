import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionPolicy } from "@relay/schema";
import { verifyArtifact, verifyPython, verifyShell } from "./artifact.js";
import { verifyGitChanged, verifyTestGate } from "./test-gate.js";
import type { GateVerdict, VerifiableStep, VerifierResult, VerifierSpec } from "./types.js";

export async function runVerifierSpec(
  spec: VerifierSpec,
  cwd: string,
  sessionPolicy?: SessionPolicy,
): Promise<VerifierResult> {
  switch (spec.type) {
    case "artifact":
      return verifyArtifact(cwd, spec.path);
    case "shell":
      return verifyShell(cwd, spec.command, {
        expectStdout: spec.expectStdout,
        expectExitCode: spec.expectExitCode,
      });
    case "python":
      return verifyPython(cwd, spec.code);
    case "test-gate":
      return verifyTestGate(cwd, { command: spec.command, sessionPolicy });
    case "git-changed":
      return verifyGitChanged(cwd, spec.minFiles);
  }
}

export async function writeVerifierEvidence(
  cwd: string,
  stepId: string,
  results: VerifierResult[],
  sessionId?: string,
): Promise<void> {
  if (!sessionId) return;
  const dir = join(cwd, ".relay", "runs", sessionId, stepId);
  await mkdir(dir, { recursive: true });
  const lines = results.map((result) => JSON.stringify({ ...result, at: new Date().toISOString() }));
  await writeFile(join(dir, "verify.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

export async function runVerifiers(
  step: VerifiableStep,
  cwd: string,
  options: { sessionId?: string; sessionPolicy?: SessionPolicy } = {},
): Promise<GateVerdict> {
  const started = Date.now();
  const specs = step.verify ?? [];
  const results = await Promise.all(
    specs.map((spec) => runVerifierSpec(spec, cwd, options.sessionPolicy)),
  );
  await writeVerifierEvidence(cwd, step.id, results, options.sessionId);

  if (results.length === 0) {
    return {
      ok: true,
      recommendation: "ACT",
      confidence: 1,
      evidence: "no step verifiers configured",
      verifierId: "compose",
      durationMs: Math.max(0, Date.now() - started),
      results,
    };
  }

  const failed = results.filter((result) => !result.ok);
  const ok = failed.length === 0;
  const confidence = ok
    ? Math.min(...results.map((result) => result.confidence))
    : Math.max(...failed.map((result) => result.confidence));
  const evidence = (ok ? results : failed).map((result) => result.evidence).join("; ");

  return {
    ok,
    recommendation: ok ? "ACT" : "BLOCK",
    confidence,
    evidence,
    verifierId: "compose",
    durationMs: Math.max(0, Date.now() - started),
    results,
  };
}
