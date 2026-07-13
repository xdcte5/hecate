import type { HarnessCard, HarnessId, ModelCard, Registry, SessionPolicy } from "@relay/schema";
import type { RouteModelReason } from "./model-router.js";
import { detectSignals, scoreAbilities } from "./task-signals.js";

/**
 * Capability vocabulary a planned step may require. The first block maps to
 * free-text `strengths`; the last two are distinctive harness `capabilities`
 * that only a harness advertising them can satisfy (Phase 2 — Pi routing).
 */
export const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  frontend: ["frontend", "ui", "react", "jsx", "tsx", "component", "css", "styling", "portfolio", "visualization"],
  backend: ["backend", "api", "server", "database", "endpoint", "typescript", "auth"],
  testing: ["test", "unit test", "coverage", "tdd", "generation"],
  debugging: ["debug", "fix", "troubleshoot", "diagnos"],
  refactor: ["refactor", "architecture", "system design", "restructure", "redesign", "reasoning"],
  review: ["review", "audit", "assess", "risk"],
  implementation: ["implement", "build", "create", "scaffold", "greenfield", "full-stack"],
  scripting: ["script", "automation", "cli", "shell"],
  "native-tool-loop": ["native-tool-loop"],
  extensions: ["extensions"],
};

/** Capabilities that can only be satisfied by an explicit harness capability tag. */
export const SPECIAL_CAPABILITIES = new Set(["native-tool-loop", "extensions"]);

type CapabilityHolder = Pick<HarnessCard, "strengths" | "weaknesses" | "capabilities"> &
  Partial<Pick<ModelCard, "capabilities">>;

/** How strongly a harness/model satisfies a single required capability. */
export function capabilityScore(holder: CapabilityHolder, capability: string): number {
  const tags = holder.capabilities ?? [];
  if (tags.includes(capability)) return 3;
  if (SPECIAL_CAPABILITIES.has(capability)) return 0; // only the explicit tag counts

  const keywords = CAPABILITY_KEYWORDS[capability] ?? [capability];
  const strengths = (holder.strengths ?? []).map((s) => s.toLowerCase());
  const weaknesses = (holder.weaknesses ?? []).map((s) => s.toLowerCase());
  const matches = (list: string[]) => keywords.some((kw) => list.some((v) => v.includes(kw)));
  if (matches(strengths)) return 2;
  if (matches(weaknesses)) return -2;
  return 0;
}

export type StepAssignmentReason = "capability-match" | "ability-match" | "failover";

export interface StepAssignment {
  harness: HarnessId;
  harnessReason: StepAssignmentReason;
  model?: string;
  modelReason: RouteModelReason;
  score: number;
  matchedCapabilities: string[];
}

export interface AssignStepInput {
  task: string;
  requiredCapabilities?: string[];
  registry: Registry;
  policy: SessionPolicy;
  /** Restrict candidates to these harnesses (user-enabled agents). */
  enabled?: HarnessId[];
}

/**
 * Assign a planned step to the best available harness + model by combining
 * task-signal ability scoring with capability matching. A distinctive
 * capability (e.g. native-tool-loop) routes straight to the harness that
 * advertises it instead of falling back down the failover chain.
 */
export function assignStep(input: AssignStepInput): StepAssignment {
  const { task, registry, policy } = input;
  const required = input.requiredCapabilities ?? [];
  const enabled = input.enabled && input.enabled.length > 0 ? new Set(input.enabled) : null;
  const candidates = registry.harnesses.filter((card) => !enabled || enabled.has(card.id));
  const signals = detectSignals(task);

  const failoverOrder = policy.failover.filter((id) => !enabled || enabled.has(id));
  const orderIndex = (id: HarnessId) => {
    const i = failoverOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  let best: HarnessCard | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCapHit = false;
  let bestMatched: string[] = [];

  for (const card of candidates) {
    const base = scoreAbilities(card.strengths, card.weaknesses, task, signals);
    let capTotal = 0;
    let specialHit = false;
    const matched: string[] = [];
    for (const cap of required) {
      const s = capabilityScore(card, cap);
      capTotal += s;
      if (s > 0) matched.push(cap);
      if (s >= 3) specialHit = true; // satisfied a distinctive capability tag
    }
    const total = base + capTotal;

    const better =
      total > bestScore ||
      (total === bestScore && orderIndex(card.id) < orderIndex(best?.id ?? ("" as HarnessId)));
    if (better) {
      best = card;
      bestScore = total;
      bestCapHit = specialHit;
      bestMatched = matched;
    }
  }

  if (!best || bestScore <= 0) {
    const fallback = failoverOrder[0] ?? policy.failover[0];
    if (!fallback) throw new Error("Session policy failover order must not be empty");
    const card = registry.harnesses.find((c) => c.id === fallback);
    const model = card ? assignModel(task, required, card, signals) : undefined;
    return {
      harness: fallback,
      harnessReason: "failover",
      model: model?.id,
      modelReason: model?.reason ?? "default",
      score: 0,
      matchedCapabilities: [],
    };
  }

  const model = assignModel(task, required, best, signals);
  return {
    harness: best.id,
    harnessReason: bestCapHit ? "capability-match" : "ability-match",
    model: model?.id,
    modelReason: model?.reason ?? "default",
    score: bestScore,
    matchedCapabilities: bestMatched,
  };
}

/** Pick the best model within a chosen harness for the task + required capabilities. */
export function assignModel(
  task: string,
  required: string[],
  card: HarnessCard,
  signals = detectSignals(task),
): { id: string; reason: RouteModelReason } | undefined {
  const models = card.models;
  if (!models?.length) return undefined;

  let best = models[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  let matched = false;

  for (const model of models) {
    const base = scoreAbilities(model.strengths, model.weaknesses ?? [], task, signals);
    const capTotal = required.reduce((sum, cap) => sum + capabilityScore(model, cap), 0);
    const total = base + capTotal;
    if (total > bestScore) {
      bestScore = total;
      best = model;
      if (total > 0) matched = true;
    }
  }

  return {
    id: best.id,
    reason: matched && bestScore > 0 ? "ability-match" : "default",
  };
}
