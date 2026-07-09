import type { Decision, RhpV1, Todo } from "@relay/schema";

export type RhpV1Patch = Partial<RhpV1>;

function mergeById<T extends { id: string }>(a: T[], b: T[] | undefined): T[] {
  if (!b) return a;
  const byId = new Map(a.map((x) => [x.id, x]));
  for (const item of b) byId.set(item.id, item);
  return [...byId.values()];
}

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeMergeAgents(
  base: RhpV1["agents"],
  patch: RhpV1["agents"] | undefined,
): RhpV1["agents"] {
  if (!patch) return base;
  const out: RhpV1["agents"] = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (BLOCKED_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Adapted from ide-bridge src/pcb/merge.ts (MIT License).
 * Merges partial RHP v1 patches with id-keyed upserts for decisions and todos.
 */
export function mergeRhpPatch(base: RhpV1, patch: RhpV1Patch): RhpV1 {
  return {
    ...base,
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.activeHarness !== undefined ? { activeHarness: patch.activeHarness } : {}),
    decisions: mergeById<Decision>(base.decisions, patch.decisions),
    todos: mergeById<Todo>(base.todos, patch.todos),
    ...(patch.git !== undefined ? { git: patch.git } : {}),
    agents: safeMergeAgents(base.agents, patch.agents),
    ...(patch.handoffSeq !== undefined ? { handoffSeq: patch.handoffSeq } : {}),
    updated_at: new Date().toISOString(),
  };
}
