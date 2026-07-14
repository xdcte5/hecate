import type { HandoffBundle, HarnessId, RhpV1 } from "@relay/schema";
import { HandoffBundleSchema } from "@relay/schema";
import { renderHandoffMarkdown } from "./render-handoff.js";

export type HandoffArtifacts = {
  bundle: HandoffBundle;
  handoffJson: string;
  handoffMarkdown: string;
};

/** Rough token estimate (~4 chars per token) for handoff budget enforcement. */
export function estimateHandoffTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Trim decisions/todos/goal until the bundle fits `maxHandoffTokens` (stub — Sprint 8). */
export function enforceMaxHandoffTokens(bundle: HandoffBundle, maxTokens: number): HandoffBundle {
  let trimmed: HandoffBundle = { ...bundle, decisions: [...bundle.decisions], todos: [...bundle.todos] };

  const fits = () => estimateHandoffTokens(JSON.stringify(trimmed)) <= maxTokens;

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
  maxHandoffTokens?: number,
): HandoffBundle {
  const bundle: HandoffBundle = {
    rhp_version: "1",
    sessionId: session.sessionId,
    targetHarness,
    sourceHarness: session.activeHarness,
    handoffSeq: session.handoffSeq + 1,
    prepared_at: new Date().toISOString(),
    goal: session.goal,
    decisions: session.decisions,
    todos: session.todos,
    git,
  };
  const parsed = HandoffBundleSchema.parse(bundle);
  if (maxHandoffTokens && maxHandoffTokens > 0) {
    return enforceMaxHandoffTokens(parsed, maxHandoffTokens);
  }
  return parsed;
}

export function buildHandoffArtifacts(
  session: RhpV1,
  targetHarness: HarnessId,
  git?: HandoffBundle["git"],
  maxHandoffTokens?: number,
): HandoffArtifacts {
  const bundle = buildHandoffBundle(session, targetHarness, git, maxHandoffTokens);
  return {
    bundle,
    handoffJson: `${JSON.stringify(bundle, null, 2)}\n`,
    handoffMarkdown: renderHandoffMarkdown(bundle),
  };
}
