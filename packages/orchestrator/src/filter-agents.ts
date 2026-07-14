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
 * Drops agents whose CLIs disappeared and adds newly detected installs
 * (e.g. pi on an nvm version bin that was missing from PATH at first scan).
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
  const merged = new Set(kept);
  for (const id of failover) {
    if (installed.has(id)) merged.add(id);
  }

  const ordered = failover.filter((id) => merged.has(id));
  return ordered.length > 0 ? ordered : failover.filter((id) => installed.has(id));
}
