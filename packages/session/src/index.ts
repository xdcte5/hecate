export { SessionStore, type SessionStoreOptions, type AgentProgress } from "./store.js";
export { appendEvent, type SessionEvent } from "./events.js";
export { readEvents } from "./read-events.js";
export { validateSession } from "./validate-session.js";
export {
  evaluateBrownfieldKpis,
  measureHandoffLatencyMs,
  type BrownfieldKpiReport,
  type BrownfieldKpiResult,
  type BrownfieldKpiTier,
} from "./brownfield-kpi.js";
export { mergeRhpPatch, type RhpV1Patch } from "./_vendor/ide-bridge/merge.js";
export { captureGitSnapshot, type GitSnapshotOptions } from "./git-snapshot.js";
export { buildHandoffBundle, buildHandoffArtifacts, enforceMaxHandoffTokens, estimateHandoffTokens, type HandoffArtifacts } from "./rhp-builder.js";
export { renderHandoffMarkdown } from "./render-handoff.js";
export { loadRelayConfig, saveRelayConfig, setActiveSessionId } from "./relay-config.js";
export { RELAY_CONFIG_RELATIVE_PATH } from "./relay-config-path.js";
export {
  trimTranscriptLines,
  estimateTokenCount,
  dedupeTranscriptLines,
} from "./transcript-trimmer.js";
export {
  importTranscripts,
  type ImportTranscriptsOptions,
  type ImportTranscriptsResult,
  type ImportedTranscript,
} from "./transcript-import.js";

export function getHandoffPath(sessionId: string): string {
  return `.relay/sessions/${sessionId}/HANDOFF.md`;
}

export function getHandoffJsonPath(sessionId: string): string {
  return `.relay/sessions/${sessionId}/handoff.json`;
}
