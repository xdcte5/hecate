import type { HarnessCard, HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { detectSignals, scoreAbilities } from "./task-signals.js";

export type RouteTaskReason = "ability-match" | "failover";

export interface RouteTaskResult {
  harness: HarnessId;
  reason: RouteTaskReason;
  score: number;
  signals?: string[];
}

function scoreHarnessCard(card: HarnessCard, task: string, signals: Set<string>): number {
  return scoreAbilities(card.strengths, card.weaknesses, task, signals);
}

export function routeTask(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): RouteTaskResult {
  const signals = detectSignals(task);
  const scores = new Map<HarnessId, number>();

  for (const card of registry.harnesses) {
    scores.set(card.id, scoreHarnessCard(card, task, signals));
  }

  const maxScore = Math.max(...scores.values(), 0);

  if (maxScore <= 0) {
    const [fallback] = policy.failover;
    if (!fallback) {
      throw new Error("Session policy failover order must not be empty");
    }
    return { harness: fallback, reason: "failover", score: 0, signals: [...signals] };
  }

  for (const harness of policy.failover) {
    if (scores.get(harness) === maxScore) {
      return {
        harness,
        reason: "ability-match",
        score: maxScore,
        signals: [...signals],
      };
    }
  }

  const [fallback] = policy.failover;
  if (!fallback) {
    throw new Error("Session policy failover order must not be empty");
  }
  return { harness: fallback, reason: "failover", score: 0, signals: [...signals] };
}

export class TaskRouter {
  constructor(
    private readonly registry: Registry,
    private readonly policy: SessionPolicy,
  ) {}

  routeTask(task: string): RouteTaskResult {
    return routeTask(task, this.registry, this.policy);
  }
}
