import type { HarnessId, StepRouting } from "@relay/schema";

export type StepRoutingKey = keyof StepRouting;

export function stepRoutingKeyForTaskType(taskType: string): StepRoutingKey {
  switch (taskType) {
    case "test":
      return "test";
    case "review":
    case "refactor":
      return "review";
    case "fix":
    case "debug":
      return "debug";
    default:
      return "implement";
  }
}

export function preferListForTaskType(
  stepRouting: StepRouting | undefined,
  taskType: string,
): HarnessId[] | undefined {
  if (!stepRouting) return undefined;
  return stepRouting[stepRoutingKeyForTaskType(taskType)]?.prefer;
}

/** Prefer list first (intersected with failover), then remaining failover entries. */
export function resolveHarnessOrder(
  prefer: HarnessId[] | undefined,
  failover: HarnessId[],
): HarnessId[] {
  if (!prefer?.length) return failover;

  const failoverSet = new Set(failover);
  const ordered: HarnessId[] = [];

  for (const harness of prefer) {
    if (failoverSet.has(harness) && !ordered.includes(harness)) {
      ordered.push(harness);
    }
  }

  for (const harness of failover) {
    if (!ordered.includes(harness)) {
      ordered.push(harness);
    }
  }

  return ordered;
}

export function filterCandidatesByPrefer<T extends { id: string }>(
  candidates: T[],
  prefer: HarnessId[] | undefined,
  failover: HarnessId[],
): T[] {
  if (!prefer?.length) return candidates;

  const failoverSet = new Set(failover);
  const preferred = prefer.filter((harness) => failoverSet.has(harness));
  if (preferred.length === 0) return candidates;

  const preferredSet = new Set(preferred);
  const filtered = candidates.filter((candidate) =>
    preferredSet.has(candidate.id as HarnessId),
  );
  return filtered.length > 0 ? filtered : candidates;
}

export function pickByHarnessOrder<T extends { id: string; blended: number }>(
  candidates: T[],
  order: HarnessId[],
  maxBlended: number,
): T | undefined {
  if (candidates.length === 0) return undefined;

  if (maxBlended <= 0) {
    for (const harness of order) {
      const match = candidates.find((candidate) => candidate.id === harness);
      if (match) return match;
    }
    return candidates[0];
  }

  for (const harness of order) {
    const match = candidates.find(
      (candidate) => candidate.id === harness && candidate.blended === maxBlended,
    );
    if (match) return match;
  }

  return candidates.reduce((best, current) =>
    current.blended > best.blended ? current : best,
  );
}

/** Keep router pick when it is in the preferred set; otherwise first preferred harness. */
export function applyStepRoutingPrefer(
  harness: HarnessId,
  prefer: HarnessId[] | undefined,
  failover: HarnessId[],
): HarnessId {
  if (!prefer?.length) return harness;

  const failoverSet = new Set(failover);
  const allowed = prefer.filter((h) => failoverSet.has(h));
  if (allowed.length === 0) return harness;
  if (allowed.includes(harness)) return harness;
  return allowed[0]!;
}
