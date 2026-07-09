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
