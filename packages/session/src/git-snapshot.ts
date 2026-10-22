import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitSnapshot } from "@relay/schema";

const execFileAsync = promisify(execFile);

export type GitSnapshotOptions = {
  includeDiffs?: boolean;
  maxDiffBytes?: number;
};

async function runGit(
  rootDir: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: rootDir,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function isGitRepo(rootDir: string): Promise<boolean> {
  const inside = await runGit(rootDir, ["rev-parse", "--is-inside-work-tree"]);
  return inside === "true";
}

function truncateDiff(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n\n… (diff truncated)`;
}

function parseStatusPaths(status: string | null): string[] {
  if (!status) return [];

  const paths = new Set<string>();
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const path =
      line[2] === " "
        ? line.slice(3)
        : line[1] === " "
          ? line.slice(2)
          : "";
    if (!path) continue;
    const renameTarget = path.includes(" -> ") ? path.slice(path.lastIndexOf(" -> ") + 4) : path;
    paths.add(renameTarget);
  }
  return [...paths];
}

export async function captureGitSnapshot(
  rootDir: string,
  options: GitSnapshotOptions = {},
): Promise<GitSnapshot | null> {
  if (!(await isGitRepo(rootDir))) return null;

  const includeDiffs = options.includeDiffs ?? false;
  const maxDiffBytes = options.maxDiffBytes ?? 32_000;

  const [branch, head, remote, dirtyRaw] = await Promise.all([
    runGit(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(rootDir, ["rev-parse", "HEAD"]),
    runGit(rootDir, ["remote", "get-url", "origin"]),
    runGit(rootDir, ["status", "--porcelain"]),
  ]);

  if (!branch || !head) return null;

  const dirty_files = parseStatusPaths(dirtyRaw);

  const snapshot: GitSnapshot = {
    remote: remote ?? "",
    branch,
    head,
    dirty_files,
  };

  if (includeDiffs) {
    const [staged, unstaged] = await Promise.all([
      runGit(rootDir, ["diff", "--cached"]),
      runGit(rootDir, ["diff"]),
    ]);
    if (staged) snapshot.staged_diff = truncateDiff(staged, maxDiffBytes);
    if (unstaged) snapshot.unstaged_diff = truncateDiff(unstaged, maxDiffBytes);
  }

  return snapshot;
}
