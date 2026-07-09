import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

/**
 * One generated file owned by an adapter. `path` is repo-relative (POSIX
 * separators); `sha256` is the checksum of the exact bytes Relay wrote.
 * `relay doctor` recomputes these to detect manual edits (drift).
 */
export const ManifestEntrySchema = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex chars"),
  bytes: z.number().int().nonnegative(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * Everything a single adapter emitted in one `relay build`. Used to render
 * files and, later, to reconcile drift.
 */
export const AdapterManifestSchema = z.object({
  harness: HarnessIdSchema,
  files: z.array(ManifestEntrySchema),
});
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

/**
 * `relay.lock` — the union of every adapter's manifest from the last build,
 * plus provenance. Committed so `relay doctor` can flag drift and stale
 * generated files.
 */
export const RelayLockSchema = z.object({
  lockfileVersion: z.literal("1"),
  generatedAt: z.string().datetime(),
  relayVersion: z.string(),
  adapters: z.array(AdapterManifestSchema),
});
export type RelayLock = z.infer<typeof RelayLockSchema>;

export const RELAY_LOCK_VERSION = "1" as const;

export function emptyRelayLock(relayVersion: string): RelayLock {
  return {
    lockfileVersion: RELAY_LOCK_VERSION,
    generatedAt: new Date().toISOString(),
    relayVersion,
    adapters: [],
  };
}
