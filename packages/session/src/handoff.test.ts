import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { HandoffBundleSchema, RhpV1Schema } from "@relay/schema";
import { captureGitSnapshot } from "./git-snapshot.js";
import { SessionStore } from "./store.js";
import { eventsPath, handoffMdPath, handoffPath, sessionPath } from "./paths.js";

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initGitRepo(dir: string): void {
  runGit(dir, ["init", "--template="]);
  runGit(dir, ["config", "user.email", "relay@test.local"]);
  runGit(dir, ["config", "user.name", "Relay Test"]);
}

describe("git-snapshot", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures branch, head, and dirty files", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-git-"));
    initGitRepo(tmpDir);
    const file = path.join(tmpDir, "README.md");
    writeFileSync(file, "# test\n");
    runGit(tmpDir, ["add", "README.md"]);
    runGit(tmpDir, ["commit", "-m", "init"]);

    writeFileSync(file, "# changed\n");
    const snapshot = await captureGitSnapshot(tmpDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.branch).toMatch(/^(main|master)$/);
    expect(snapshot?.head).toMatch(/^[a-f0-9]{40}$/);
    expect(snapshot?.dirty_files).toContain("README.md");
  });

  it("returns null outside a git repo", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-nogit-"));
    const snapshot = await captureGitSnapshot(tmpDir);
    expect(snapshot).toBeNull();
  });
});

describe("SessionStore handoff", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prepareHandoff writes handoff files and events", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-handoff-"));
    initGitRepo(tmpDir);
    const readme = path.join(tmpDir, "README.md");
    writeFileSync(readme, "# relay\n");
    runGit(tmpDir, ["add", "README.md"]);
    runGit(tmpDir, ["commit", "-m", "init"]);

    const store = new SessionStore({ rootDir: tmpDir });
    const session = await store.start("ship handoff");
    await store.recordDecision(session.sessionId, "Use pnpm workspaces");

    const bundle = await store.prepareHandoff(session.sessionId, "codex");
    expect(bundle.targetHarness).toBe("codex");
    expect(bundle.handoffSeq).toBe(1);

    expect(existsSync(handoffPath(tmpDir, session.sessionId))).toBe(true);
    expect(existsSync(handoffMdPath(tmpDir, session.sessionId))).toBe(true);

    const parsedBundle = HandoffBundleSchema.parse(
      JSON.parse(readFileSync(handoffPath(tmpDir, session.sessionId), "utf8")),
    );
    expect(parsedBundle.goal).toBe("ship handoff");

    const md = readFileSync(handoffMdPath(tmpDir, session.sessionId), "utf8");
    expect(md).toContain("Use pnpm workspaces");

    const updated = RhpV1Schema.parse(
      JSON.parse(readFileSync(sessionPath(tmpDir, session.sessionId), "utf8")),
    );
    expect(updated.activeHarness).toBe("codex");
    expect(updated.handoffSeq).toBe(1);
    expect(updated.git?.branch).toBeTruthy();

    const events = readFileSync(eventsPath(tmpDir, session.sessionId), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((e) => e.event === "session_started")).toBe(true);
    expect(events.some((e) => e.event === "decision_recorded")).toBe(true);
    expect(events.some((e) => e.event === "handoff_prepared")).toBe(true);
  });
});
