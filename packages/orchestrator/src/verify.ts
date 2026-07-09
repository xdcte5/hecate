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
