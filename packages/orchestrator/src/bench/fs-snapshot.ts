import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const IGNORED_DIRS = new Set([".git", ".relay", "node_modules", "dist", ".next", "coverage"]);

export type DirSnapshot = Map<string, string>;

/**
 * Record a lightweight signature (size:mtime) for every file under `dir`,
 * skipping build/VCS noise. Diffing two snapshots tells us which files a run
 * changed — without depending on git being initialized.
 */
export async function snapshotDir(dir: string): Promise<DirSnapshot> {
  const snap: DirSnapshot = new Map();
  await walk(dir, dir, snap);
  return snap;
}

async function walk(root: string, current: string, snap: DirSnapshot): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(root, join(current, entry.name), snap);
    } else if (entry.isFile()) {
      const full = join(current, entry.name);
      try {
        const info = await stat(full);
        snap.set(relative(root, full), `${info.size}:${info.mtimeMs}`);
      } catch {
        // file vanished mid-walk — ignore
      }
    }
  }
}

/** Relative paths that were added, removed, or modified between two snapshots. */
export function diffSnapshot(before: DirSnapshot, after: DirSnapshot): string[] {
  const changed = new Set<string>();
  for (const [path, sig] of after) {
    if (before.get(path) !== sig) changed.add(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.add(path);
  }
  return [...changed].sort();
}
