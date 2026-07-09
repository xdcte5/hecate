import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/**
 * Run a user-configured verification command (from `relay/orchestrator.yaml`).
 * Passing means exit code 0. A stricter gate than the file-change check.
 */
export async function runVerifyCommand(
  cwd: string,
  command: string,
): Promise<{ ok: boolean; message: string; files: string[] }> {
  try {
    await execFileAsync("sh", ["-c", command], { cwd, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, message: `verify passed (${command})`, files: [] };
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr?.trim().split("\n").pop() ?? String(err);
    return { ok: false, message: `verify failed (${command}): ${detail}`, files: [] };
  }
}

export async function verifyImplementWave(
  cwd: string,
  minFiles = 1,
): Promise<{ ok: boolean; message: string; files: string[] }> {
  const files = await listChangedFiles(cwd);
  if (files.length < minFiles) {
    return {
      ok: false,
      message: `No project files changed yet (found ${files.length}, need ${minFiles})`,
      files,
    };
  }
  return {
    ok: true,
    message: `${files.length} file(s) changed`,
    files,
  };
}
