import type { HarnessId, RelayLock } from "@relay/schema";
import {
  type Adapter,
  type BuildContext,
  emptyBuildContext,
  type GeneratedFile,
} from "./adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { PiAdapter } from "./pi.js";
import { GeminiAdapter } from "./gemini.js";
import {
  buildAdapterManifest,
  buildRelayLock,
  writeGeneratedFiles,
  writeRelayLock,
} from "./manifest.js";
import { readRelaySource, type RelaySource } from "./source.js";

/** All harness adapters, keyed by harness. */
const ADAPTERS: Record<HarnessId, Adapter | undefined> = {
  "claude-code": new ClaudeAdapter(),
  codex: new CodexAdapter(),
  cursor: new CursorAdapter(),
  pi: new PiAdapter(),
  "gemini-cli": new GeminiAdapter(),
};

export function getAdapter(harness: HarnessId): Adapter {
  const adapter = ADAPTERS[harness];
  if (!adapter) throw new Error(`No adapter registered for harness: ${harness}`);
  return adapter;
}

export function availableHarnesses(): HarnessId[] {
  return (Object.keys(ADAPTERS) as HarnessId[]).filter((h) => ADAPTERS[h] !== undefined);
}

export interface BuildOptions {
  /** Restrict the build to these harnesses; omitted means all available. */
  harnesses?: HarnessId[];
  context?: BuildContext;
  relayVersion?: string;
  /** Pre-read source (used by `relay watch` to avoid re-reading). */
  source?: RelaySource;
  /**
   * Opt-in global scope for Pi (`relay build --pi-global`). When set, Pi's
   * files are written under this directory (e.g. `~/.pi`) instead of the
   * project root, and are not recorded in the repo-scoped `relay.lock`.
   */
  piGlobalHome?: string;
}

/**
 * Guard against two adapters emitting different content for the same path
 * (e.g. Codex vs Pi diverging on `AGENTS.md` because of per-harness
 * instruction overrides). Identical content is fine — it's the shared-standard
 * case. Divergence is a real conflict the user must resolve.
 */
function assertNoConflicts(filesByHarness: Record<string, GeneratedFile[]>): void {
  const seen = new Map<string, { harness: string; content: string }>();
  for (const [harness, files] of Object.entries(filesByHarness)) {
    for (const file of files) {
      const prior = seen.get(file.path);
      if (prior && prior.content !== file.content) {
        throw new Error(
          `Conflicting output for ${file.path}: ${prior.harness} and ${harness} disagree. ` +
            `These harnesses share this path — align their instructions or disable one.`,
        );
      }
      if (!prior) seen.set(file.path, { harness, content: file.content });
    }
  }
}

export interface BuildResult {
  lock: RelayLock;
  filesByHarness: Record<string, GeneratedFile[]>;
  totalFiles: number;
}

/**
 * Transpile `relay/` into every selected harness layout, write the files, and
 * write `relay.lock`. Pure adapters run first; disk writes happen last.
 */
export async function buildProject(
  root: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const source = options.source ?? (await readRelaySource(root));
  const ctx = options.context ?? emptyBuildContext;
  const relayVersion = options.relayVersion ?? "0.1.0";

  const targets = (options.harnesses ?? availableHarnesses()).filter(
    (h) => ADAPTERS[h] !== undefined,
  );

  // Generate all adapters first (pure), then check conflicts before any write.
  const filesByHarness: Record<string, GeneratedFile[]> = {};
  for (const harness of targets) {
    filesByHarness[harness] = getAdapter(harness).generate(source, ctx);
  }
  assertNoConflicts(filesByHarness);

  const manifests = [];
  let totalFiles = 0;

  for (const harness of targets) {
    const files = filesByHarness[harness]!;
    totalFiles += files.length;

    // Pi in global scope writes outside the repo and is not tracked in relay.lock.
    if (harness === "pi" && options.piGlobalHome) {
      await writeGeneratedFiles(options.piGlobalHome, files);
      continue;
    }

    await writeGeneratedFiles(root, files);
    manifests.push(buildAdapterManifest(harness, files));
  }

  const lock = buildRelayLock(relayVersion, manifests);
  await writeRelayLock(root, lock);

  return { lock, filesByHarness, totalFiles };
}
