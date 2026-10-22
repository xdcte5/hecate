import type { HarnessId } from "@relay/schema";

/** Restrict routing/failover to user-enabled harnesses. */
export function filterEnabledAgents(
  failover: HarnessId[],
  enabledAgents?: HarnessId[],
): HarnessId[] {
  if (!enabledAgents || enabledAgents.length === 0) return failover;
  const allowed = new Set(enabledAgents);
  const filtered = failover.filter((id) => allowed.has(id));
  const extras = enabledAgents.filter((id) => !filtered.includes(id));
  const merged = [...filtered, ...extras];
  return merged.length > 0 ? merged : [...enabledAgents];
}

/**
 * Merge user-enabled agents with currently installed harnesses.
 * Drops agents whose CLIs disappeared. A non-empty enabled list is authoritative:
 * do not add installed harnesses the user did not select.
 */
export function syncEnabledAgentsWithInstalled(
  enabledAgents: HarnessId[],
  installedAgents: HarnessId[],
  failover: HarnessId[],
): HarnessId[] {
  const installed = new Set(installedAgents);

  if (enabledAgents.length === 0) {
    return failover.filter((id) => installed.has(id));
  }

  const kept = enabledAgents.filter((id) => installed.has(id));
  const ordered = failover.filter((id) => kept.includes(id));
  const extras = kept.filter((id) => !ordered.includes(id));
  return [...ordered, ...extras];
}
