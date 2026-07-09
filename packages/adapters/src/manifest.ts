import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AdapterManifest,
  HarnessId,
  ManifestEntry,
  RelayLock,
} from "@relay/schema";
import { RELAY_LOCK_VERSION, RelayLockSchema } from "@relay/schema";
import type { GeneratedFile } from "./adapter.js";

export const RELAY_LOCK_FILE = "relay.lock";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function toManifestEntry(file: GeneratedFile): ManifestEntry {
  const bytes = Buffer.byteLength(file.content, "utf8");
  return { path: file.path, sha256: sha256(file.content), bytes };
}

/** Build a single adapter's manifest from the files it generated. */
export function buildAdapterManifest(
  harness: HarnessId,
  files: GeneratedFile[],
): AdapterManifest {
  return {
    harness,
    files: files
      .map(toManifestEntry)
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Write generated files to disk, creating parent directories as needed. */
export async function writeGeneratedFiles(
  root: string,
  files: GeneratedFile[],
): Promise<void> {
  for (const file of files) {
    const abs = join(root, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf8");
  }
}

export function buildRelayLock(
  relayVersion: string,
  adapters: AdapterManifest[],
  now: () => Date = () => new Date(),
): RelayLock {
  return {
    lockfileVersion: RELAY_LOCK_VERSION,
    generatedAt: now().toISOString(),
    relayVersion,
    adapters: [...adapters].sort((a, b) => a.harness.localeCompare(b.harness)),
  };
}

export async function writeRelayLock(root: string, lock: RelayLock): Promise<void> {
  await writeFile(join(root, RELAY_LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function readRelayLock(root: string): Promise<RelayLock | null> {
  try {
    const raw = await readFile(join(root, RELAY_LOCK_FILE), "utf8");
    return RelayLockSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export type DriftKind = "missing" | "modified";

export interface DriftFinding {
  harness: HarnessId;
  path: string;
  kind: DriftKind;
}

/**
 * Compare `relay.lock` against files on disk. A file is `missing` if it no
 * longer exists, `modified` if its bytes no longer match the recorded sha256.
 */
export async function detectDrift(
  root: string,
  lock: RelayLock,
): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];
  for (const adapter of lock.adapters) {
    for (const entry of adapter.files) {
      let content: string;
      try {
        content = await readFile(join(root, entry.path), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          findings.push({ harness: adapter.harness, path: entry.path, kind: "missing" });
          continue;
        }
        throw err;
      }
      if (sha256(content) !== entry.sha256) {
        findings.push({ harness: adapter.harness, path: entry.path, kind: "modified" });
      }
    }
  }
  return findings;
}
