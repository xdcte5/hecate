import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { VerifierResult } from "./types.js";

const execFileAsync = promisify(execFile);

function elapsed(started: number): number {
  return Math.max(0, Date.now() - started);
}

export async function verifyArtifact(cwd: string, path: string): Promise<VerifierResult> {
  const started = Date.now();
  try {
    await access(resolve(cwd, path));
    return {
      verifierId: "artifact",
      status: "PASS",
      ok: true,
      confidence: 1,
      evidence: `${path} exists`,
      durationMs: elapsed(started),
    };
  } catch {
    return {
      verifierId: "artifact",
      status: "FAIL",
      ok: false,
      confidence: 1,
      evidence: `${path} missing`,
      durationMs: elapsed(started),
    };
  }
}

export async function verifyShell(
  cwd: string,
  command: string,
  options: { expectStdout?: string; expectExitCode?: number } = {},
): Promise<VerifierResult> {
  const started = Date.now();
  const shell = process.platform === "win32" ? "cmd.exe" : "sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const expectExitCode = options.expectExitCode ?? 0;

  try {
    const { stdout } = await execFileAsync(shell, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    if (expectExitCode !== 0) {
      return {
        verifierId: "shell",
        status: "FAIL",
        ok: false,
        confidence: 0.95,
        evidence: `expected exit ${expectExitCode}, got 0`,
        durationMs: elapsed(started),
      };
    }
    if (options.expectStdout !== undefined && stdout !== options.expectStdout) {
      return {
        verifierId: "shell",
        status: "FAIL",
        ok: false,
        confidence: 0.95,
        evidence: `stdout mismatch for "${command}": expected ${JSON.stringify(options.expectStdout)}, got ${JSON.stringify(stdout)}`,
        durationMs: elapsed(started),
      };
    }
    return {
      verifierId: "shell",
      status: "PASS",
      ok: true,
      confidence: 0.95,
      evidence: `shell passed: ${command}`,
      durationMs: elapsed(started),
    };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    const code = typeof err.code === "number" ? err.code : 1;
    if (code === expectExitCode && options.expectStdout === undefined) {
      return {
        verifierId: "shell",
        status: "PASS",
        ok: true,
        confidence: 0.9,
        evidence: `shell exited ${code} as expected: ${command}`,
        durationMs: elapsed(started),
      };
    }
    const detail = (err.stderr ?? err.stdout ?? err.message ?? "shell verifier failed").trim();
    return {
      verifierId: "shell",
      status: "FAIL",
      ok: false,
      confidence: 0.95,
      evidence: `shell failed (${command}): ${detail || `exit ${code}`}`,
      durationMs: elapsed(started),
    };
  }
}

export async function verifyPython(cwd: string, code: string): Promise<VerifierResult> {
  const started = Date.now();
  for (const binary of ["python3", "python"]) {
    try {
      await execFileAsync(binary, ["-c", code], {
        cwd,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
      });
      return {
        verifierId: "python",
        status: "PASS",
        ok: true,
        confidence: 0.95,
        evidence: `python assertion passed: ${code}`,
        durationMs: elapsed(started),
      };
    } catch (error) {
      const err = error as { code?: string | number; stderr?: string; message?: string };
      if (err.code === "ENOENT") continue;
      const detail = (err.stderr ?? err.message ?? "python verifier failed").trim().split("\n").at(-1);
      return {
        verifierId: "python",
        status: "FAIL",
        ok: false,
        confidence: 0.95,
        evidence: `python assertion failed: ${detail ?? code}`,
        durationMs: elapsed(started),
      };
    }
  }

  return {
    verifierId: "python",
    status: "FAIL",
    ok: false,
    confidence: 0.5,
    evidence: "python verifier failed: no python executable found",
    durationMs: elapsed(started),
  };
}
