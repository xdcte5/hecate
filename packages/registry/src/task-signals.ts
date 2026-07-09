/** Task intent signals — classify the prompt, not assign a harness or model. */
export const SIGNAL_PATTERNS: Record<string, RegExp> = {
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

/** Vocabulary linking registry strength/weakness phrases to task signals. */
export const SIGNAL_VOCAB: Record<string, string[]> = {
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

/** Higher weight = more specific task intent when scoring signal affinities. */
export const SIGNAL_WEIGHT: Record<string, number> = {
  test: 3,
  refactor: 2.5,
  review: 2.5,
  debug: 2,
  frontend: 2,
  backend: 2,
  script: 2,
  implement: 1,
};

export function detectSignals(task: string): Set<string> {
  const signals = new Set<string>();
  for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
    if (pattern.test(task)) {
      signals.add(signal);
    }
  }

  // Explicit test intent should not lose to incidental nouns in the goal clause.
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
  if (needle.includes(" ")) {
    return normalized.includes(needle);
  }
  return new RegExp(`\\b${escapeRegex(needle)}\\b`, "i").test(task);
}

function relatesToSignal(phrase: string, signal: string): boolean {
  const lower = phrase.toLowerCase();
  const vocab = SIGNAL_VOCAB[signal] ?? [];
  return vocab.some((word) => lower.includes(word) || word.includes(lower.split(/\s+/)[0] ?? ""));
}

export function scoreAbilities(
  strengths: string[],
  weaknesses: string[],
  task: string,
  signals: Set<string>,
): number {
  let score = 0;

  for (const strength of strengths) {
    if (phraseInTask(task, strength)) {
      score += 4;
    }
    for (const signal of signals) {
      if (relatesToSignal(strength, signal)) {
        score += SIGNAL_WEIGHT[signal] ?? 1;
      }
    }
  }

  for (const weakness of weaknesses) {
    if (phraseInTask(task, weakness)) {
      score -= 2;
    }
    for (const signal of signals) {
      if (relatesToSignal(weakness, signal)) {
        score -= (SIGNAL_WEIGHT[signal] ?? 1) * 0.5;
      }
    }
  }

  return score;
}
