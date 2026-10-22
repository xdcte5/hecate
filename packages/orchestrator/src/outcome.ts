import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { listChangedFiles } from "./verify.js";

const execFileAsync = promisify(execFile);

const DEFERRED_APPROVAL =
  /waiting on your approval|pending writes|please approve|nothing has been written yet|queued and waiting/i;
const FS_SNAPSHOT_PREFIX = "fs:";
const GIT_SNAPSHOT_PREFIX = "git:";
const IGNORED_FS_DIRS = new Set([".git", ".relay", "node_modules"]);

async function gitPorcelain(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parsePorcelainLines(porcelain: string): string[] {
  if (porcelain.startsWith(GIT_SNAPSHOT_PREFIX)) {
    porcelain = porcelain.slice(GIT_SNAPSHOT_PREFIX.length);
  }
  if (porcelain.startsWith(FS_SNAPSHOT_PREFIX)) {
    return parseFilesystemSnapshot(porcelain);
  }

  return porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

function parseFilesystemSnapshot(snapshot: string): string[] {
  return snapshot
    .slice(FS_SNAPSHOT_PREFIX.length)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(0, line.indexOf("\t")))
    .filter(Boolean);
}

function diffFilesystemSnapshots(before: string, after: string): string[] {
  const beforeLines = new Map(
    before
      .slice(FS_SNAPSHOT_PREFIX.length)
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("\t")), line]),
  );
  return after
    .slice(FS_SNAPSHOT_PREFIX.length)
    .split("\n")
    .filter(Boolean)
    .filter((line) => beforeLines.get(line.slice(0, line.indexOf("\t"))) !== line)
    .map((line) => line.slice(0, line.indexOf("\t")));
}

/** Files that changed between two git porcelain snapshots. */
export function diffChangedFiles(treeBefore: string, treeAfter: string): string[] {
  if (
    treeBefore.startsWith(FS_SNAPSHOT_PREFIX) &&
    treeAfter.startsWith(FS_SNAPSHOT_PREFIX)
  ) {
    return diffFilesystemSnapshots(treeBefore, treeAfter);
  }

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
  const porcelain = await gitPorcelain(cwd);
  if (porcelain || (await isGitRepo(cwd))) {
    return `${GIT_SNAPSHOT_PREFIX}${porcelain}`;
  }
  return `${FS_SNAPSHOT_PREFIX}${await filesystemSnapshot(cwd)}`;
}

/** Populate filesTouched from git diff when the driver did not report them. */
export async function resolveFilesTouched(
  cwd: string,
  treeBefore = "",
  existing?: string[],
): Promise<string[]> {
  if (existing && existing.length > 0) return existing;
  if (treeBefore) {
    const treeAfter = await snapshotWorkingTree(cwd);
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

  const treeAfter = await snapshotWorkingTree(cwd);
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

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function filesystemSnapshot(cwd: string): Promise<string> {
  const rows: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_FS_DIRS.has(entry.name)) {
        continue;
      }

      const path = join(dir, entry.name);
      const rel = relative(cwd, path);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      try {
        const [metadata, content] = await Promise.all([stat(path), readFile(path)]);
        const hash = createHash("sha256").update(content).digest("hex");
        rows.push(`${rel}\t${metadata.size}\t${hash}`);
      } catch {
        // Files can disappear while an agent is writing; the next snapshot will settle them.
      }
    }
  }

  await visit(cwd);
  return rows.sort().join("\n");
}
