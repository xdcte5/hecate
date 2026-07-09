import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

/** Agent claimed success but left edits blocked on human approval. */
export function hasDeferredApproval(output?: string): boolean {
  if (!output) return false;
  return DEFERRED_APPROVAL.test(output);
}

export async function snapshotWorkingTree(cwd: string): Promise<string> {
  return gitPorcelain(cwd);
}

export async function verifyWriteOutcome(
  cwd: string,
  output?: string,
  treeBefore = "",
): Promise<{ ok: boolean; message: string }> {
  if (hasDeferredApproval(output)) {
    return {
      ok: false,
      message:
        "Agent stopped with edits waiting for approval — enable auto-approve and re-run.",
    };
  }

  const treeAfter = await gitPorcelain(cwd);
  if (treeBefore === treeAfter) {
    return {
      ok: false,
      message: "Agent finished but no files changed in the project.",
    };
  }

  const changedCount = treeAfter.split("\n").filter(Boolean).length;
  return {
    ok: true,
    message: `${changedCount} file(s) changed`,
  };
}
