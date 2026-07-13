import type { HarnessCard, HarnessId, Registry } from "@relay/schema";

export interface AbilityChoice {
  harness: HarnessId;
  model?: string;
  /** The ability score (planning or conversation) that won this choice. */
  score: number;
}

function bestModelBy(card: HarnessCard, key: "planning" | "conversation"): { id?: string; score: number } {
  const harnessScore = card[key] ?? 0;
  if (!card.models?.length) return { score: harnessScore };
  let bestId: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const model of card.models) {
    const s = model[key] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestId = model.id;
    }
  }
  // The harness is only as strong as its rating; the model tells us which one to prefer.
  return { id: bestId, score: Math.max(harnessScore, bestScore) };
}

function rankBy(
  registry: Registry,
  key: "planning" | "conversation",
  available?: HarnessId[],
): AbilityChoice[] {
  const allow = available && available.length > 0 ? new Set(available) : null;
  const order = available ?? [];
  return registry.harnesses
    .filter((card) => !allow || allow.has(card.id))
    .map((card) => {
      const best = bestModelBy(card, key);
      return { harness: card.id, model: best.id, score: best.score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: prefer the caller's availability order when given.
      return order.indexOf(a.harness) - order.indexOf(b.harness);
    });
}

/** Harnesses ranked best-first by planning/decomposition ability. */
export function rankPlanners(registry: Registry, available?: HarnessId[]): AbilityChoice[] {
  return rankBy(registry, "planning", available);
}

/** The single best available planner, or null if none qualify. */
export function selectPrimaryPlanner(registry: Registry, available?: HarnessId[]): AbilityChoice | null {
  const ranked = rankPlanners(registry, available).filter((c) => c.score > 0);
  return ranked[0] ?? null;
}

/** Harnesses ranked best-first by conversational ability. */
export function rankConversationalists(registry: Registry, available?: HarnessId[]): AbilityChoice[] {
  return rankBy(registry, "conversation", available);
}

/** The single best available conversationalist for chit-chat / explanations. */
export function selectConversationalist(
  registry: Registry,
  available?: HarnessId[],
): AbilityChoice | null {
  const ranked = rankConversationalists(registry, available).filter((c) => c.score > 0);
  return ranked[0] ?? null;
}
