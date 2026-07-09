import fs from "node:fs/promises";
import path from "node:path";
import { captureGitSnapshot } from "./git-snapshot.js";
import { handoffMdPath } from "./paths.js";
import { readEvents } from "./read-events.js";
import { validateSession } from "./validate-session.js";

export type BrownfieldKpiTier = 1 | 2 | 3;

export type BrownfieldKpiResult = {
  tier: BrownfieldKpiTier;
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  automatable: boolean;
};

export type BrownfieldKpiReport = {
  results: BrownfieldKpiResult[];
  tier1Passed: number;
  tier1Total: number;
  tier2Passed: number;
  tier2Total: number;
  automatablePassed: number;
  automatableTotal: number;
};

async function liveGitSnapshot(
  rootDir: string,
): Promise<{ branch: string; head: string; dirty_files: string[] } | null> {
  return captureGitSnapshot(rootDir);
}

export async function evaluateBrownfieldKpis(
  rootDir: string,
  sessionId: string,
): Promise<BrownfieldKpiReport> {
  const results: BrownfieldKpiResult[] = [];
  const validation = await validateSession(rootDir, sessionId);
  const events = await readEvents(rootDir, sessionId).catch(() => []);
  const session = validation.session;

  // Tier 1 — Does it work?
  results.push({
    tier: 1,
    id: "rhp_schema_valid",
    name: "RHP schema validity after handoff",
    passed: validation.valid,
    detail: validation.valid
      ? "relay doctor --session passes"
      : validation.errors.join("; "),
    automatable: true,
  });

  let gitAccurate = false;
  if (session?.git) {
    const live = await liveGitSnapshot(rootDir);
    if (live) {
      gitAccurate =
        live.branch === session.git.branch &&
        live.head === session.git.head &&
        [...live.dirty_files].sort().join() === [...session.git.dirty_files].sort().join();
    }
  }
  results.push({
    tier: 1,
    id: "git_snapshot_accuracy",
    name: "Git snapshot accuracy on handoff",
    passed: session?.git ? gitAccurate : false,
    detail: session?.git
      ? gitAccurate
        ? "branch/HEAD/dirty_files match live git"
        : "session git does not match live repo"
      : "no git snapshot on session (handoff required)",
    automatable: true,
  });

  results.push({
    tier: 1,
    id: "handoff_context_completeness",
    name: "Handoff context completeness (user survey)",
    passed: false,
    detail: "Manual: 8/10 users report no re-explaining needed",
    automatable: false,
  });

  // Tier 2 — Do we understand?
  const hopEvents = events.filter((e) => e.event === "handoff_prepared");
  results.push({
    tier: 2,
    id: "trace_hop_history",
    name: "relay trace shows clear hop history",
    passed: hopEvents.length > 0 && events.some((e) => e.event === "session_started"),
    detail: `${hopEvents.length} handoff hop(s), ${events.length} total events`,
    automatable: true,
  });

  let handoffReadable = false;
  if (session && session.handoffSeq > 0) {
    try {
      const md = await fs.readFile(handoffMdPath(rootDir, sessionId), "utf8");
      handoffReadable =
        md.includes(session.goal) &&
        md.includes("## Goal") &&
        md.includes("## Decisions");
    } catch {
      handoffReadable = false;
    }
  }
  results.push({
    tier: 2,
    id: "session_state_grokable",
    name: "Time to read session state (< 30 sec)",
    passed: handoffReadable || Boolean(session?.goal),
    detail: handoffReadable
      ? "HANDOFF.md contains goal and decisions sections"
      : "session.json has goal; run handoff for HANDOFF.md",
    automatable: true,
  });

  // Tier 3 — Can we own it?
  const relayDir = path.join(rootDir, "relay");
  const configFiles = ["registry.yaml", "session-policy.yaml"];
  let configOk = true;
  for (const file of configFiles) {
    try {
      await fs.access(path.join(relayDir, file));
    } catch {
      configOk = false;
    }
  }
  results.push({
    tier: 3,
    id: "relay_config_understandable",
    name: "relay/ config understandable without deep docs",
    passed: configOk,
    detail: configOk
      ? "relay/registry.yaml and session-policy.yaml present"
      : "missing relay/ config files",
    automatable: true,
  });

  results.push({
    tier: 3,
    id: "no_generated_drift",
    name: "No generated file drift after dogfood",
    passed: false,
    detail: "Requires Dev B relay doctor (manifest checksums) — pending harness fabric",
    automatable: false,
  });

  const tier1 = results.filter((r) => r.tier === 1 && r.automatable);
  const tier2 = results.filter((r) => r.tier === 2 && r.automatable);
  const automatable = results.filter((r) => r.automatable);

  return {
    results,
    tier1Passed: tier1.filter((r) => r.passed).length,
    tier1Total: tier1.length,
    tier2Passed: tier2.filter((r) => r.passed).length,
    tier2Total: tier2.length,
    automatablePassed: automatable.filter((r) => r.passed).length,
    automatableTotal: automatable.length,
  };
}

export async function measureHandoffLatencyMs(
  fn: () => Promise<unknown>,
): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}
