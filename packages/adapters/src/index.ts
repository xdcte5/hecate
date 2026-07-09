export {
  type Adapter,
  type BuildContext,
  type GeneratedFile,
  BaseAdapter,
  emptyBuildContext,
} from "./adapter.js";

export {
  type RelaySource,
  type SourceFile,
  type McpConfig,
  type McpServer,
  readRelaySource,
} from "./source.js";

export { ClaudeAdapter } from "./claude.js";
export { CodexAdapter } from "./codex.js";
export { CursorAdapter } from "./cursor.js";
export { PiAdapter } from "./pi.js";

export {
  toClaudeJson,
  toCodexToml,
  toCursorJson,
  fromClaudeJson,
  fromCodexToml,
  fromCursorJson,
} from "./mcp-transform.js";

export {
  type BuildOptions,
  type BuildResult,
  buildProject,
  getAdapter,
  availableHarnesses,
} from "./build.js";

export {
  type DriftFinding,
  type DriftKind,
  RELAY_LOCK_FILE,
  sha256,
  toManifestEntry,
  buildAdapterManifest,
  buildRelayLock,
  writeGeneratedFiles,
  writeRelayLock,
  readRelayLock,
  detectDrift,
} from "./manifest.js";

export { isBinaryInstalled, detectInstalledBinaries } from "./detect.js";
