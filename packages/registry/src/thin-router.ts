import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";

export type SelectHarnessReason = "routing-rule" | "strength-match" | "failover";

export interface SelectHarnessResult {
  harness: HarnessId;
  reason: SelectHarnessReason;
  matchedPattern?: string;
  strengthScore?: number;
}

function compileRoutingPattern(pattern: string): RegExp {
  if (pattern.startsWith("(?i)")) {
    return new RegExp(pattern.slice(4), "i");
  }

  return new RegExp(pattern);
}

function matchRoutingRule(
  task: string,
  policy: SessionPolicy,
): { harness: HarnessId; pattern: string } | undefined {
  for (const rule of policy.routing) {
    try {
      const regex = compileRoutingPattern(rule.pattern);
      if (regex.test(task)) {
        return { harness: rule.harness, pattern: rule.pattern };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function scoreStrengthMatches(task: string, registry: Registry): Map<HarnessId, number> {
  const normalizedTask = task.toLowerCase();
  const scores = new Map<HarnessId, number>();

  for (const card of registry.harnesses) {
    let score = 0;
    for (const strength of card.strengths) {
      if (normalizedTask.includes(strength.toLowerCase())) {
        score += 1;
      }
    }
    scores.set(card.id, score);
  }

  return scores;
}

function pickByStrengths(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): { harness: HarnessId; score: number } | undefined {
  const scores = scoreStrengthMatches(task, registry);
  const maxScore = Math.max(...scores.values());

  if (maxScore === 0) {
    return undefined;
  }

  for (const harness of policy.failover) {
    if (scores.get(harness) === maxScore) {
      return { harness, score: maxScore };
    }
  }

  return undefined;
}

export function selectHarness(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): HarnessId {
  return selectHarnessDetailed(task, registry, policy).harness;
}

export function selectHarnessDetailed(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): SelectHarnessResult {
  const routingMatch = matchRoutingRule(task, policy);
  if (routingMatch) {
    return {
      harness: routingMatch.harness,
      reason: "routing-rule",
      matchedPattern: routingMatch.pattern,
    };
  }

  const strengthMatch = pickByStrengths(task, registry, policy);
  if (strengthMatch) {
    return {
      harness: strengthMatch.harness,
      reason: "strength-match",
      strengthScore: strengthMatch.score,
    };
  }

  const [fallback] = policy.failover;
  if (!fallback) {
    throw new Error("Session policy failover order must not be empty");
  }

  return {
    harness: fallback,
    reason: "failover",
  };
}

export class ThinRouter {
  constructor(
    private readonly registry: Registry,
    private readonly policy: SessionPolicy,
  ) {}

  selectHarness(task: string): HarnessId {
    return selectHarness(task, this.registry, this.policy);
  }

  selectHarnessDetailed(task: string): SelectHarnessResult {
    return selectHarnessDetailed(task, this.registry, this.policy);
  }
}
