import type { SessionPolicy } from "@relay/schema";
import { listChangedFiles, resolveTestCommand, runTestGate } from "../verify.js";
import type { VerifierResult } from "./types.js";

function elapsed(started: number): number {
  return Math.max(0, Date.now() - started);
}

export async function verifyTestGate(
  cwd: string,
  options: { command?: string; sessionPolicy?: SessionPolicy } = {},
): Promise<VerifierResult> {
  const started = Date.now();
  const command = await resolveTestCommand(cwd, {
    testCommand: options.command,
    sessionPolicy: options.sessionPolicy,
  });
  if (!command) {
    return {
      verifierId: "test-gate",
      status: "SKIP",
      ok: true,
      confidence: 1,
      evidence: "test gate skipped: no command resolved",
      durationMs: elapsed(started),
    };
  }

  const result = await runTestGate(cwd, command);
  return {
    verifierId: "test-gate",
    status: result.ok ? "PASS" : "FAIL",
    ok: result.ok,
    confidence: result.ok ? 0.95 : 0.9,
    evidence: result.message,
    durationMs: elapsed(started),
  };
}

export async function verifyGitChanged(
  cwd: string,
  minFiles = 1,
): Promise<VerifierResult> {
  const started = Date.now();
  const files = await listChangedFiles(cwd);
  const ok = files.length >= minFiles;
  return {
    verifierId: "git-changed",
    status: ok ? "PASS" : "FAIL",
    ok,
    confidence: 0.85,
    evidence: ok
      ? `${files.length} changed file(s)`
      : `not enough changed files: found ${files.length}, need ${minFiles}`,
    durationMs: elapsed(started),
  };
}
