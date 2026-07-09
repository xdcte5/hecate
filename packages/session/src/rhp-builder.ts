import type { HandoffBundle, HarnessId, RhpV1 } from "@relay/schema";
import { HandoffBundleSchema } from "@relay/schema";
import { renderHandoffMarkdown } from "./render-handoff.js";

export type HandoffArtifacts = {
  bundle: HandoffBundle;
  handoffJson: string;
  handoffMarkdown: string;
};

export function buildHandoffBundle(
  session: RhpV1,
  targetHarness: HarnessId,
  git?: HandoffBundle["git"],
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
  return HandoffBundleSchema.parse(bundle);
}

export function buildHandoffArtifacts(
  session: RhpV1,
  targetHarness: HarnessId,
  git?: HandoffBundle["git"],
): HandoffArtifacts {
  const bundle = buildHandoffBundle(session, targetHarness, git);
  return {
    bundle,
    handoffJson: `${JSON.stringify(bundle, null, 2)}\n`,
    handoffMarkdown: renderHandoffMarkdown(bundle),
  };
}
