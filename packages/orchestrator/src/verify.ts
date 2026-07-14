import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  resolveSessionPolicyVerification,
  type SessionPolicy,
} from "@relay/schema";

const execFileAsync = promisify(execFile);

export type VerifyWaveOptions = {
  minFiles?: number;
  /** Explicit override; null skips test gate entirely. */
  testCommand?: string | null;
  sessionPolicy?: SessionPolicy;
};

export async function listChangedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

/** Resolve the test command from env, session policy, or package.json scripts. */
export async function resolveTestCommand(
  cwd: string,
  options: Pick<VerifyWaveOptions, "testCommand" | "sessionPolicy"> = {},
): Promise<string | null> {
  if (options.testCommand === null) return null;
  if (options.testCommand) return options.testCommand;

  const envCommand = process.env.RELAY_VERIFY_TEST_COMMAND?.trim();
  if (envCommand && envCommand !== "undefined") return envCommand;

  if (options.sessionPolicy) {
    const verification = resolveSessionPolicyVerification(options.sessionPolicy);
    if (!verification.enableTestGate) return null;
    if (verification.testCommand === null) return null;
    if (verification.testCommand) return verification.testCommand;
  }

  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      return "pnpm test";
    }
  } catch {
    // no package.json or invalid JSON
  }

  return null;
}

export async function runTestGate(
  cwd: string,
  command: string,
): Promise<{ ok: boolean; message: string }> {
  const shell = process.platform === "win32" ? "cmd.exe" : "sh";
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

  try {
    await execFileAsync(shell, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    return { ok: true, message: `Tests passed (${command})` };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const detail = (err.stderr ?? err.message ?? "test command failed").trim().split("\n")[0];
    return { ok: false, message: `Test gate failed (${command}): ${detail}` };
  }
}

export async function verifyImplementWave(
  cwd: string,
  options: VerifyWaveOptions = {},
): Promise<{ ok: boolean; message: string; files: string[] }> {
  const minFiles = options.minFiles ?? 1;
  const files = await listChangedFiles(cwd);
  if (files.length < minFiles) {
    return {
      ok: false,
      message: `No project files changed yet (found ${files.length}, need ${minFiles})`,
      files,
    };
  }

  const testCommand = await resolveTestCommand(cwd, options);
  if (testCommand) {
    const testResult = await runTestGate(cwd, testCommand);
    if (!testResult.ok) {
      return { ok: false, message: testResult.message, files };
    }
    return {
      ok: true,
      message: `${files.length} file(s) changed; ${testResult.message}`,
      files,
    };
  }

  return {
    ok: true,
    message: `${files.length} file(s) changed`,
    files,
  };
}
