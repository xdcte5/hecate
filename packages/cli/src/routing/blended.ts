import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadRelayConfig, ThinRouter, type SelectHarnessResult } from "@relay/registry";
import type {
  HarnessId,
  Registry,
  RoutingConfig,
  RoutingOutcome,
  RoutingPriors,
  RoutingRule,
  SessionPolicy,
} from "@relay/schema";
import {
  HarnessIdSchema,
  resolveSessionPolicyRoutingConfig,
  RoutingOutcomeSchema,
  RoutingPriorsSchema,
} from "@relay/schema";

export const ROUTING_PRIORS_RELATIVE_PATH = join("relay", "routing-priors.yaml");
export const ROUTING_STATS_RELATIVE_PATH = join(".relay", "routing-stats.jsonl");

export type BlendScores = {
  local: number;
  benchmark: number;
  heuristic: number;
};

export type HandoffRoutingResult = Omit<SelectHarnessResult, "reason"> & {
  reason: SelectHarnessResult["reason"] | "blended" | "routing-rule" | "benchmark";
  blendScores?: BlendScores;
  pattern?: string;
};

type BlendedCapableRouter = ThinRouter & {
  selectHarnessBlended?: (task: string) => HandoffRoutingResult;
};

const SIGNAL_PATTERNS: Record<string, RegExp> = {
  test: /\b(test|tests|unit test|vitest|jest|mocha|coverage|tdd)\b/i,
  debug: /\b(fix|debug|bug|broken|error|troubleshoot|repair|patch|issue)\b/i,
  frontend:
    /\b(react|jsx|tsx|frontend|ui|component|page|portfolio|website|graph|visualization|css|tailwind|landing|navbar|hero|screen|view)\b/i,
  backend:
    /\b(api|backend|endpoint|server|database|auth|graphql|postgres|middleware|jwt|session|oauth)\b/i,
  script: /\b(script|automation|cli|shell)\b/i,
  implement: /\b(build|create|implement|scaffold|greenfield|setup|set up)\b/i,
  refactor: /\b(refactor|architecture|system design|restructure|migrate|redesign)\b/i,
  review: /\b(review|audit|assess|risk)\b/i,
};

const SIGNAL_VOCAB: Record<string, string[]> = {
  test: ["test", "tests", "unit", "vitest", "jest", "coverage", "tdd", "mocha", "generation"],
  debug: ["debug", "debugging", "fix", "troubleshoot", "diagnos"],
  frontend: [
    "react",
    "frontend",
    "ui",
    "jsx",
    "tsx",
    "component",
    "portfolio",
    "page",
    "graph",
    "visualization",
    "styling",
    "ide",
  ],
  backend: ["api", "backend", "endpoint", "server", "database", "typescript", "design"],
  script: ["script", "scripts", "cli", "shell", "automation"],
  implement: ["implement", "implementation", "build", "create", "scaffold", "greenfield", "full-stack"],
  refactor: ["refactor", "refactoring", "architecture", "design", "reasoning", "system"],
  review: ["review", "audit", "assess"],
};

const SIGNAL_WEIGHT: Record<string, number> = {
  test: 3,
  refactor: 2.5,
  review: 2.5,
  debug: 2,
  frontend: 2,
  backend: 2,
  script: 2,
  implement: 1,
};

function detectSignals(task: string): Set<string> {
  const signals = new Set<string>();
  for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
    if (pattern.test(task)) signals.add(signal);
  }

  if (signals.has("test") && /\b(write unit tests|unit test|vitest|jest|coverage|tdd)\b/i.test(task)) {
    for (const signal of [...signals]) {
      if (signal !== "test" && (SIGNAL_WEIGHT[signal] ?? 0) < SIGNAL_WEIGHT.test!) {
        signals.delete(signal);
      }
    }
  }

  return signals;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseInTask(task: string, phrase: string): boolean {
  const normalized = task.toLowerCase();
  const needle = phrase.toLowerCase();
  if (needle.includes(" ")) return normalized.includes(needle);
  return new RegExp(`\\b${escapeRegex(needle)}\\b`, "i").test(task);
}

function relatesToSignal(phrase: string, signal: string): boolean {
  const lower = phrase.toLowerCase();
  const vocab = SIGNAL_VOCAB[signal] ?? [];
  return vocab.some((word) => lower.includes(word) || word.includes(lower.split(/\s+/)[0] ?? ""));
}

function scoreAbilities(
  strengths: string[],
  weaknesses: string[],
  task: string,
  signals: Set<string>,
): number {
  let score = 0;

  for (const strength of strengths) {
    if (phraseInTask(task, strength)) score += 4;
    for (const signal of signals) {
      if (relatesToSignal(strength, signal)) score += SIGNAL_WEIGHT[signal] ?? 1;
    }
  }

  for (const weakness of weaknesses) {
    if (phraseInTask(task, weakness)) score -= 2;
    for (const signal of signals) {
      if (relatesToSignal(weakness, signal)) score -= (SIGNAL_WEIGHT[signal] ?? 1) * 0.5;
    }
  }

  return score;
}

export function inferTaskType(task: string): string {
  const signals = detectSignals(task);
  if (signals.has("test")) return "test";
  if (signals.has("debug")) return "fix";
  if (signals.has("refactor")) return "refactor";
  if (signals.has("review")) return "review";
  if (signals.has("script")) return "script";
  if (signals.has("frontend") || signals.has("backend") || signals.has("implement")) {
    return "implement";
  }
  return "implement";
}

export function matchRoutingRule(task: string, rules: RoutingRule[]): RoutingRule | undefined {
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern).test(task)) return rule;
    } catch {
      // Skip invalid patterns.
    }
  }
  return undefined;
}

export async function loadRoutingPriors(cwd: string): Promise<RoutingPriors | null> {
  try {
    const content = await readFile(join(cwd, ROUTING_PRIORS_RELATIVE_PATH), "utf8");
    return RoutingPriorsSchema.parse(parseYaml(content));
  } catch {
    return null;
  }
}

export async function loadRoutingStats(cwd: string): Promise<RoutingOutcome[]> {
  try {
    const content = await readFile(join(cwd, ROUTING_STATS_RELATIVE_PATH), "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => RoutingOutcomeSchema.parse(JSON.parse(line)));
  } catch {
    return [];
  }
}

function parseHarnessFromTarget(target: string): HarnessId | null {
  const [head] = target.split("/");
  const parsed = HarnessIdSchema.safeParse(head);
  return parsed.success ? parsed.data : null;
}

function benchmarkScoreForHarness(
  harness: HarnessId,
  taskType: string,
  priors: RoutingPriors | null,
  signals: Set<string>,
): number {
  if (!priors) return 0;

  const taskScores = priors.task_types[taskType] ?? priors.task_types.implement ?? {};
  let best = 0;

  for (const [target, score] of Object.entries(taskScores)) {
    if (parseHarnessFromTarget(target) !== harness) continue;
    best = Math.max(best, score);
  }

  for (const adjustment of priors.signal_adjustments ?? []) {
    if (!signals.has(adjustment.signal)) continue;
    if (parseHarnessFromTarget(adjustment.target) === harness) {
      best = Math.min(1, best + adjustment.adjustment);
    }
  }

  return best;
}

type LocalComboStats = {
  key: string;
  harness: HarnessId;
  model?: string;
  successes: number;
  total: number;
};

function localScoresForHarness(
  harness: HarnessId,
  taskType: string,
  stats: RoutingOutcome[],
  minLocalSamples: number,
): { score: number; samples: number } {
  const relevant = stats.filter((entry) => entry.taskType === taskType && entry.harness === harness);
  if (relevant.length < minLocalSamples) {
    return { score: 0, samples: relevant.length };
  }

  const successes = relevant.filter((entry) => entry.ok).length;
  return { score: successes / relevant.length, samples: relevant.length };
}

export function summarizeLocalStats(stats: RoutingOutcome[]): LocalComboStats[] {
  const buckets = new Map<string, LocalComboStats>();

  for (const entry of stats) {
    const key = entry.model ? `${entry.harness}/${entry.model}` : entry.harness;
    const bucket = buckets.get(key) ?? {
      key,
      harness: entry.harness,
      model: entry.model,
      successes: 0,
      total: 0,
    };
    bucket.total += 1;
    if (entry.ok) bucket.successes += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => {
    const rateA = a.total > 0 ? a.successes / a.total : 0;
    const rateB = b.total > 0 ? b.successes / b.total : 0;
    if (rateB !== rateA) return rateB - rateA;
    return b.total - a.total;
  });
}

function heuristicScores(
  task: string,
  registry: Registry,
): Map<HarnessId, number> {
  const signals = detectSignals(task);
  const scores = new Map<HarnessId, number>();

  for (const card of registry.harnesses) {
    scores.set(card.id, scoreAbilities(card.strengths, card.weaknesses, task, signals));
  }

  return scores;
}

function normalizeHeuristicScores(scores: Map<HarnessId, number>): Map<HarnessId, number> {
  const max = Math.max(...scores.values(), 0);
  const normalized = new Map<HarnessId, number>();
  for (const [harness, score] of scores) {
    normalized.set(harness, max > 0 ? Math.min(1, Math.max(0, score / max)) : 0);
  }
  return normalized;
}

function pickByFailover<T extends { harness: HarnessId; blended: number }>(
  ranked: T[],
  failover: HarnessId[],
): T {
  const best = ranked[0]!.blended;
  const ties = ranked.filter((entry) => entry.blended === best);
  for (const harness of failover) {
    const match = ties.find((entry) => entry.harness === harness);
    if (match) return match;
  }
  return ranked[0]!;
}

export function resolveBlendedHarness(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
  routingConfig: RoutingConfig,
  priors: RoutingPriors | null,
  stats: RoutingOutcome[],
): HandoffRoutingResult {
  const rule = matchRoutingRule(task, policy.routing);
  if (rule) {
    return {
      harness: rule.harness,
      reason: "routing-rule",
      pattern: rule.pattern,
      signals: [...detectSignals(task)],
    };
  }

  const taskType = inferTaskType(task);
  const signals = detectSignals(task);
  const heurRaw = heuristicScores(task, registry);
  const heur = normalizeHeuristicScores(heurRaw);

  const ranked = policy.failover.map((harness) => {
    const local = localScoresForHarness(harness, taskType, stats, routingConfig.min_local_samples);
    const benchmark = benchmarkScoreForHarness(harness, taskType, priors, signals);
    const heuristic = heur.get(harness) ?? 0;
    const { local: wLocal, benchmark: wBench, heuristic: wHeur } = routingConfig.blend;
    const hasLocal = local.samples >= routingConfig.min_local_samples;
    const effectiveLocal = hasLocal ? local.score : 0;
    const blended =
      wLocal * effectiveLocal + wBench * benchmark + wHeur * heuristic;

    return {
      harness,
      blended,
      blendScores: {
        local: effectiveLocal,
        benchmark,
        heuristic,
      } satisfies BlendScores,
    };
  });

  ranked.sort((a, b) => b.blended - a.blended);
  const winner = pickByFailover(ranked, policy.failover);

  return {
    harness: winner.harness,
    reason: "blended",
    score: winner.blended,
    blendScores: winner.blendScores,
    signals: [...signals],
  };
}

function resolveBenchmarkHarness(
  task: string,
  registry: Registry,
  policy: SessionPolicy,
  priors: RoutingPriors | null,
): HandoffRoutingResult {
  const rule = matchRoutingRule(task, policy.routing);
  if (rule) {
    return {
      harness: rule.harness,
      reason: "routing-rule",
      pattern: rule.pattern,
      signals: [...detectSignals(task)],
    };
  }

  const taskType = inferTaskType(task);
  const signals = detectSignals(task);
  const ranked = policy.failover.map((harness) => ({
    harness,
    score: benchmarkScoreForHarness(harness, taskType, priors, signals),
  }));
  ranked.sort((a, b) => b.score - a.score);
  const winner = pickByFailover(
    ranked.map((entry) => ({ harness: entry.harness, blended: entry.score })),
    policy.failover,
  );
  const topScore = ranked.find((entry) => entry.harness === winner.harness)?.score ?? 0;

  return {
    harness: winner.harness,
    reason: "benchmark",
    score: topScore,
    signals: [...signals],
  };
}

export async function resolveHandoffRouting(
  cwd: string,
  task: string,
  registry: Registry,
  policy: SessionPolicy,
): Promise<HandoffRoutingResult> {
  const routingConfig = resolveSessionPolicyRoutingConfig(policy);
  const router = new ThinRouter(registry, policy) as BlendedCapableRouter;

  if (typeof router.selectHarnessBlended === "function") {
    return router.selectHarnessBlended(task);
  }

  const rule = matchRoutingRule(task, policy.routing);
  if (rule) {
    return {
      harness: rule.harness,
      reason: "routing-rule",
      pattern: rule.pattern,
      signals: [...detectSignals(task)],
    };
  }

  if (routingConfig.mode === "heuristic") {
    const result = router.selectHarnessDetailed(task);
    return { ...result, reason: result.reason };
  }

  const [priors, stats] = await Promise.all([loadRoutingPriors(cwd), loadRoutingStats(cwd)]);

  if (routingConfig.mode === "benchmark") {
    return resolveBenchmarkHarness(task, registry, policy, priors);
  }

  return resolveBlendedHarness(task, registry, policy, routingConfig, priors, stats);
}

export async function previewRoute(
  cwd: string,
  task: string,
): Promise<HandoffRoutingResult> {
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  return resolveHandoffRouting(cwd, task, registry, sessionPolicy);
}

export function topPriorsByTaskType(
  priors: RoutingPriors,
): Array<{ taskType: string; target: string; score: number }> {
  const rows: Array<{ taskType: string; target: string; score: number }> = [];

  for (const [taskType, scores] of Object.entries(priors.task_types)) {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [target, score] = sorted[0] ?? ["(none)", 0];
    rows.push({ taskType, target, score });
  }

  return rows.sort((a, b) => a.taskType.localeCompare(b.taskType));
}
