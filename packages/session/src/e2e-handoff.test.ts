import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HandoffBundleSchema } from "@relay/schema";
import { evaluateBrownfieldKpis, measureHandoffLatencyMs } from "./brownfield-kpi.js";
import { readEvents } from "./read-events.js";
import { SessionStore } from "./store.js";
import { validateSession } from "./validate-session.js";
import { handoffMdPath, handoffPath } from "./paths.js";

const fixtureRoot = path.join(
  import.meta.dirname,
  "../../../fixtures/minimal-relay",
);

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initGitRepo(dir: string): void {
  runGit(dir, ["init", "--template="]);
  runGit(dir, ["config", "user.email", "relay@test.local"]);
  runGit(dir, ["config", "user.name", "Relay Test"]);
}

function scaffoldRelayProject(dir: string): void {
  cpSync(path.join(fixtureRoot, "relay"), path.join(dir, "relay"), { recursive: true });
  writeFileSync(path.join(dir, "README.md"), "# relay e2e\n");
  initGitRepo(dir);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "init"]);
}

describe("E2E handoff flow (Dev A Sprint 4)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("session → decision → handoff → doctor → trace (multi-harness)", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-e2e-"));
    scaffoldRelayProject(tmpDir);

    const store = new SessionStore({ rootDir: tmpDir });
    const session = await store.start("fix React component");
    await store.recordDecision(session.sessionId, "Use existing design system tokens");

    const latencyMs = await measureHandoffLatencyMs(() =>
      store.prepareHandoff(session.sessionId, "cursor"),
    );
    expect(latencyMs).toBeLessThan(3000);

    await store.prepareHandoff(session.sessionId, "codex");

    const validation = await validateSession(tmpDir, session.sessionId);
    expect(validation.valid).toBe(true);

    const bundle = HandoffBundleSchema.parse(
      JSON.parse(readFileSync(handoffPath(tmpDir, session.sessionId), "utf8")),
    );
    expect(bundle.targetHarness).toBe("codex");
    expect(bundle.handoffSeq).toBe(2);

    const md = readFileSync(handoffMdPath(tmpDir, session.sessionId), "utf8");
    expect(md).toContain("fix React component");
    expect(md).toContain("Use existing design system tokens");

    const events = await readEvents(tmpDir, session.sessionId);
    expect(events.some((e) => e.event === "session_started")).toBe(true);
    expect(events.some((e) => e.event === "decision_recorded")).toBe(true);
    expect(events.filter((e) => e.event === "handoff_prepared").length).toBe(2);

    const kpi = await evaluateBrownfieldKpis(tmpDir, session.sessionId);
    expect(kpi.tier1Passed).toBe(kpi.tier1Total);
    expect(kpi.tier2Passed).toBe(kpi.tier2Total);
    expect(kpi.automatablePassed).toBeGreaterThanOrEqual(4);
  });

  it("Brownfield tier-1 fails without handoff git snapshot", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-kpi-"));
    cpSync(path.join(fixtureRoot, "relay"), path.join(tmpDir, "relay"), { recursive: true });

    const store = new SessionStore({ rootDir: tmpDir });
    const session = await store.start("oauth-login");

    const kpi = await evaluateBrownfieldKpis(tmpDir, session.sessionId);
    const gitKpi = kpi.results.find((r) => r.id === "git_snapshot_accuracy");
    expect(gitKpi?.passed).toBe(false);
    expect(existsSync(handoffPath(tmpDir, session.sessionId))).toBe(false);
  });
});
