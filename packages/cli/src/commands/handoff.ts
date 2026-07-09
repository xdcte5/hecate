import { Command } from "commander";
import {
  HarnessIdSchema,
  resolveSessionPolicyGovernance,
  type HarnessId,
  type SessionPolicy,
} from "@relay/schema";
import {
  loadRelayConfig,
  ThinRouter,
  type SelectHarnessResult,
} from "@relay/registry";
import {
  captureGitSnapshot,
  getHandoffPath,
  importTranscripts,
  SessionStore,
} from "@relay/session";
import { copyToClipboard } from "../clipboard.js";
import { gateProFeature } from "../pro-gate.js";

export type HandoffTarget = HarnessId | "auto";

export function parseHandoffTarget(to: string): HandoffTarget {
  if (to === "auto") return "auto";

  const parsed = HarnessIdSchema.safeParse(to);
  if (!parsed.success) {
    throw new Error(
      `Invalid harness "${to}". Expected one of: auto, claude-code, codex, cursor, pi`,
    );
  }

  return parsed.data;
}

export function formatRoutingReason(result: SelectHarnessResult): string {
  switch (result.reason) {
    case "routing-rule":
      return `routing-rule (pattern: ${result.matchedPattern})`;
    case "strength-match":
      return `strength-match (score: ${result.strengthScore})`;
    case "failover":
      return "failover";
  }
}

/** When auto picks the active harness, advance to the next failover target. */
export function rotateAwayFromCurrent(
  selected: HarnessId,
  current: HarnessId | undefined,
  failover: HarnessId[],
): HarnessId {
  if (!current || selected !== current) return selected;

  const start = failover.indexOf(current);
  if (start === -1) {
    return failover.find((h) => h !== current) ?? selected;
  }

  for (let i = 1; i < failover.length; i++) {
    const candidate = failover[(start + i) % failover.length]!;
    if (candidate !== current) return candidate;
  }

  return selected;
}

export async function resolveAutoHandoffTarget(
  cwd: string,
  goal: string,
  currentHarness?: HarnessId,
): Promise<{ harness: HarnessId; routing: SelectHarnessResult; policy: SessionPolicy; rotated: boolean }> {
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const router = new ThinRouter(registry, sessionPolicy);
  const routing = router.selectHarnessDetailed(goal);
  const harness = rotateAwayFromCurrent(
    routing.harness,
    currentHarness,
    sessionPolicy.failover,
  );

  return {
    harness,
    routing,
    policy: sessionPolicy,
    rotated: harness !== routing.harness,
  };
}

async function maybeImportTranscripts(
  cwd: string,
  sessionId: string,
  policy: SessionPolicy,
): Promise<void> {
  const governance = resolveSessionPolicyGovernance(policy);

  try {
    await importTranscripts(cwd, sessionId, {
      maxLines: governance.maxTranscriptLines,
    });
  } catch {
    // Best effort — transcript import is optional.
  }
}

async function enforceGitSnapshotGovernance(
  cwd: string,
  policy: SessionPolicy,
): Promise<void> {
  const governance = resolveSessionPolicyGovernance(policy);
  if (!governance.requireGitSnapshotOnHandoff) return;

  const git = await captureGitSnapshot(cwd);
  if (!git) {
    throw new Error(
      "Git snapshot required for handoff (governance.requireGitSnapshotOnHandoff) but none available. " +
        "Initialize a git repo or disable the requirement in relay/session-policy.yaml.",
    );
  }
}

export function registerHandoffCommands(program: Command, getCwd: () => string): void {
  program
    .command("handoff")
    .description("Prepare handoff bundle for another harness")
    .requiredOption(
      "--to <harness>",
      "Target harness (auto, claude-code, codex, cursor, pi)",
    )
    .option("--lossless", "Include git diffs in snapshot (larger bundle)")
    .option("--smart", "Pro: LLM-assisted routing (coming in v0.2)")
    .action(async (options: { to: string; lossless?: boolean; smart?: boolean }) => {
      gateProFeature("AI smart handoff (--smart)", Boolean(options.smart));
      const target = parseHandoffTarget(options.to);
      const cwd = getCwd();
      const store = new SessionStore({
        rootDir: cwd,
        includeGitDiffs: Boolean(options.lossless),
      });
      const active = await store.getActive();
      if (!active) {
        throw new Error("No active session. Run: relay session start <goal>");
      }

      let targetHarness: HarnessId;
      let sessionPolicy: SessionPolicy | undefined;

      if (target === "auto") {
        const resolved = await resolveAutoHandoffTarget(cwd, active.goal, active.activeHarness);
        targetHarness = resolved.harness;
        sessionPolicy = resolved.policy;
        console.log(`Auto-routed to: ${targetHarness}`);
        console.log(`Reason: ${formatRoutingReason(resolved.routing)}`);
        if (resolved.rotated) {
          console.log(
            `Note: router picked ${resolved.routing.harness} but you are already there — rotated to ${targetHarness}`,
          );
        }
      } else {
        targetHarness = target;
      }

      if (sessionPolicy) {
        await enforceGitSnapshotGovernance(cwd, sessionPolicy);
        await maybeImportTranscripts(cwd, active.sessionId, sessionPolicy);
      } else {
        const { sessionPolicy: loadedPolicy } = await loadRelayConfig(cwd);
        await enforceGitSnapshotGovernance(cwd, loadedPolicy);
        await maybeImportTranscripts(cwd, active.sessionId, loadedPolicy);
      }

      const bundle = await store.prepareHandoff(active.sessionId, targetHarness);
      const handoffRel = getHandoffPath(active.sessionId);
      const prompt = [
        `Continue Relay session "${bundle.goal}".`,
        `Read ${handoffRel} before acting.`,
      ].join(" ");

      const copied = await copyToClipboard(prompt);
      console.log(`Handoff prepared for: ${bundle.targetHarness}`);
      console.log(`Session: ${bundle.sessionId}`);
      console.log(`Handoff #${bundle.handoffSeq}`);
      console.log(`Files:`);
      console.log(`  ${handoffRel}`);
      console.log(`  ${handoffRel.replace("HANDOFF.md", "handoff.json")}`);
      if (copied) {
        console.log("Clipboard: short prompt copied");
      } else {
        console.log(`Prompt: ${prompt}`);
      }
    });
}
