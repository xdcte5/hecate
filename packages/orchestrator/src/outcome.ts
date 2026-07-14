import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listChangedFiles } from "./verify.js";

const execFileAsync = promisify(execFile);

const DEFERRED_APPROVAL =
  /waiting on your approval|pending writes|please approve|nothing has been written yet|queued and waiting/i;

async function gitPorcelain(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parsePorcelainLines(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

/** Files that changed between two git porcelain snapshots. */
export function diffChangedFiles(treeBefore: string, treeAfter: string): string[] {
  const before = new Set(parsePorcelainLines(treeBefore));
  const after = parsePorcelainLines(treeAfter);
  return after.filter((file) => !before.has(file));
}

/** Agent claimed success but left edits blocked on human approval. */
export function hasDeferredApproval(output?: string): boolean {
  if (!output) return false;
  return DEFERRED_APPROVAL.test(output);
}

export async function snapshotWorkingTree(cwd: string): Promise<string> {
  return gitPorcelain(cwd);
}

/** Populate filesTouched from git diff when the driver did not report them. */
export async function resolveFilesTouched(
  cwd: string,
  treeBefore = "",
  existing?: string[],
): Promise<string[]> {
  if (existing && existing.length > 0) return existing;
  if (treeBefore) {
    const treeAfter = await gitPorcelain(cwd);
    const diff = diffChangedFiles(treeBefore, treeAfter);
    if (diff.length > 0) return diff;
  }
  return listChangedFiles(cwd);
}

export async function verifyWriteOutcome(
  cwd: string,
  output?: string,
  treeBefore = "",
): Promise<{ ok: boolean; message: string; filesTouched: string[] }> {
  if (hasDeferredApproval(output)) {
    return {
      ok: false,
      message:
        "Agent stopped with edits waiting for approval — enable auto-approve and re-run.",
      filesTouched: [],
    };
  }

  const treeAfter = await gitPorcelain(cwd);
  const filesTouched = diffChangedFiles(treeBefore, treeAfter);
  if (filesTouched.length === 0 && treeBefore === treeAfter) {
    return {
      ok: false,
      message: "Agent finished but no files changed in the project.",
      filesTouched: [],
    };
  }

  return {
    ok: true,
    message: `${filesTouched.length} file(s) changed`,
    filesTouched,
  };
}
