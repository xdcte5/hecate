import type { HarnessId, RelayLock } from "@relay/schema";
import {
  type Adapter,
  type BuildContext,
  emptyBuildContext,
  type GeneratedFile,
} from "./adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import {
  buildAdapterManifest,
  buildRelayLock,
  writeGeneratedFiles,
  writeRelayLock,
} from "./manifest.js";
import { readRelaySource, type RelaySource } from "./source.js";

/** All adapters, keyed by harness. Cursor and Pi land in Sprint 2. */
const ADAPTERS: Record<HarnessId, Adapter | undefined> = {
  "claude-code": new ClaudeAdapter(),
  codex: new CodexAdapter(),
  cursor: undefined,
  pi: undefined,
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

  const filesByHarness: Record<string, GeneratedFile[]> = {};
  const manifests = [];
  let totalFiles = 0;

  for (const harness of targets) {
    const files = getAdapter(harness).generate(source, ctx);
    filesByHarness[harness] = files;
    manifests.push(buildAdapterManifest(harness, files));
    await writeGeneratedFiles(root, files);
    totalFiles += files.length;
  }

  const lock = buildRelayLock(relayVersion, manifests);
  await writeRelayLock(root, lock);

  return { lock, filesByHarness, totalFiles };
}
