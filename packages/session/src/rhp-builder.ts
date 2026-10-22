import type { Decision, GitSnapshot, HandoffBundle, HarnessId, RhpV1 } from "@relay/schema";
import { HandoffBundleSchema } from "@relay/schema";
import { renderHandoffMarkdown } from "./render-handoff.js";

export type HandoffTier = "implement" | "test" | "review" | "debug" | "full";

export type HandoffBuildOptions = {
  tier?: HandoffTier;
  maxTokens?: number;
  testHint?: string;
};

export type HandoffArtifacts = {
  bundle: HandoffBundle;
  handoffJson: string;
  handoffMarkdown: string;
};

/** Map a plan step task type to a handoff compression tier. */
export function handoffTierForTaskType(taskType: string): HandoffTier {
  switch (taskType) {
    case "implement":
    case "implement-frontend":
    case "implement-backend":
      return "implement";
    case "test":
      return "test";
    case "review":
    case "refactor":
      return "review";
    case "fix":
      return "debug";
    default:
      return "full";
  }
}

/** Rough token estimate (~4 chars per token) for handoff budget enforcement. */
export function estimateHandoffTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function bundlePayload(bundle: HandoffBundle, tier: HandoffTier): string {
  return JSON.stringify(bundle) + renderHandoffMarkdown(bundle, tier);
}

function stripGitDiffs(git: GitSnapshot): GitSnapshot {
  const { staged_diff: _s, unstaged_diff: _u, ...rest } = git;
  return rest;
}

function filterGitForTier(git: GitSnapshot | undefined, tier: HandoffTier): GitSnapshot | undefined {
  if (!git) return undefined;

  switch (tier) {
    case "implement":
      return undefined;
    case "test":
      return {
        remote: "",
        branch: git.branch,
        head: git.head,
        dirty_files: git.dirty_files,
      };
    case "review":
      return stripGitDiffs(git);
    case "debug":
      return {
        remote: "",
        branch: git.branch,
        head: git.head.slice(0, 12),
        dirty_files: git.dirty_files.slice(0, 8),
      };
    case "full":
    default:
      return git;
  }
}

function filterDecisionsForTier(decisions: Decision[], tier: HandoffTier): Decision[] {
  switch (tier) {
    case "test":
      return [];
    case "debug":
      return decisions.length > 0 ? [decisions[decisions.length - 1]!] : [];
    case "implement":
    case "review":
    case "full":
    default:
      return decisions;
  }
}

function filterTodosForTier(todos: RhpV1["todos"], tier: HandoffTier): RhpV1["todos"] {
  switch (tier) {
    case "test":
    case "review":
      return [];
    case "debug": {
      const active = todos.filter((t) => t.status !== "done");
      return active.length > 0 ? [active[active.length - 1]!] : [];
    }
    case "implement":
    case "full":
    default:
      return todos;
  }
}

/** Trim verbose sections until the bundle fits `maxHandoffTokens`. */
export function enforceMaxHandoffTokens(
  bundle: HandoffBundle,
  maxTokens: number,
  tier: HandoffTier = "full",
): HandoffBundle {
  let trimmed: HandoffBundle = {
    ...bundle,
    decisions: [...bundle.decisions],
    todos: [...bundle.todos],
    ...(bundle.git ? { git: { ...bundle.git, dirty_files: [...bundle.git.dirty_files] } } : {}),
  };

  const fits = () => estimateHandoffTokens(bundlePayload(trimmed, tier)) <= maxTokens;

  if (trimmed.git?.staged_diff || trimmed.git?.unstaged_diff) {
    trimmed = { ...trimmed, git: stripGitDiffs(trimmed.git) };
  }

  while (!fits() && trimmed.git && trimmed.git.dirty_files.length > 0) {
    trimmed = {
      ...trimmed,
      git: { ...trimmed.git, dirty_files: trimmed.git.dirty_files.slice(0, -1) },
    };
  }

  while (!fits() && trimmed.decisions.length > 0) {
    trimmed.decisions.shift();
  }

  while (!fits() && trimmed.todos.length > 0) {
    trimmed.todos.pop();
  }

  while (!fits() && trimmed.goal.length > 80) {
    trimmed = { ...trimmed, goal: `${trimmed.goal.slice(0, trimmed.goal.length - 200)}…` };
  }

  return HandoffBundleSchema.parse(trimmed);
}

export function buildHandoffBundle(
  session: RhpV1,
  targetHarness: HarnessId,
  git?: HandoffBundle["git"],
  options: HandoffBuildOptions = {},
): HandoffBundle {
  const tier = options.tier ?? "full";
  const filteredGit = filterGitForTier(git, tier);

  const bundle: HandoffBundle = {
    rhp_version: "1",
    sessionId: session.sessionId,
    targetHarness,
    sourceHarness: session.activeHarness,
    handoffSeq: session.handoffSeq + 1,
    prepared_at: new Date().toISOString(),
    goal: session.goal,
    decisions: filterDecisionsForTier(session.decisions, tier),
    todos: filterTodosForTier(session.todos, tier),
    ...(filteredGit ? { git: filteredGit } : {}),
  };

  const parsed = HandoffBundleSchema.parse(bundle);
  const maxTokens = options.maxTokens;
  if (maxTokens && maxTokens > 0) {
    return enforceMaxHandoffTokens(parsed, maxTokens, tier);
  }
  return parsed;
}

export function buildHandoffArtifacts(
  session: RhpV1,
  targetHarness: HarnessId,
  git?: HandoffBundle["git"],
  options: HandoffBuildOptions = {},
): HandoffArtifacts {
  const tier = options.tier ?? "full";
  const bundle = buildHandoffBundle(session, targetHarness, git, options);
  return {
    bundle,
    handoffJson: `${JSON.stringify(bundle, null, 2)}\n`,
    handoffMarkdown: renderHandoffMarkdown(bundle, tier, options.testHint),
  };
}
