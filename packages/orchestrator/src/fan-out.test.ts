import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessId, Registry } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { executePlan } from "./execute-plan.js";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./drivers/types.js";
import { initRunState } from "./runner-state.js";
import type { RunStep } from "./types.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function initGit(dir: string): void {
  execFileSync("git", ["init", "--template="], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@t.local"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# fan-out\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "pipe" });
}

// Registry whose binaries are `true` (installed everywhere) so resolution passes.
const registry: Registry = {
  harnesses: [
    { id: "cursor", strengths: ["frontend"], weaknesses: [], binaries: ["true"] },
    { id: "codex", strengths: ["backend"], weaknesses: [], binaries: ["true"] },
  ],
};

/** Fake driver: records the handoff path it saw and writes a file so verify passes. */
function makeFakeDriver(seen: string[]): (h: HarnessId, b: string) => HarnessDriver {
  return () => ({
    kind: "cli" as const,
    async run(req: DriverRequest): Promise<HarnessRunResult> {
      seen.push(req.handoffPath);
      writeFileSync(join(req.cwd, `${req.harness}-out.txt`), "done\n");
      return { ok: true, harness: req.harness, summary: `${req.harness} ok` };
    },
  });
}

describe("executor fan-out into child sub-sessions", () => {
  it("runs each parallel step against its own child session and merges back", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-fanout-"));
    initGit(tmp);

    const store = new SessionStore({ rootDir: tmp });
    const parent = await store.start("build frontend and backend");

    const steps: RunStep[] = [
      { id: "implement-frontend", task: "frontend", harness: "cursor", reason: "ability-match", wave: 0, status: "pending" },
      { id: "implement-backend", task: "backend", harness: "codex", reason: "ability-match", wave: 0, status: "pending" },
    ];
    const state = initRunState(parent.goal, parent.sessionId, steps);

    const seen: string[] = [];
    const result = await executePlan({
      cwd: tmp,
      state,
      store,
      registry,
      failover: ["cursor", "codex"],
      subSessions: true,
      createDriver: makeFakeDriver(seen),
    });

    expect(result.ok).toBe(true);

    // Two isolated children were created and merged back into the parent.
    const children = await store.listChildren(parent.sessionId);
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.parentId).toBe(parent.sessionId);
      expect(child.status).toBe("completed");
    }

    // Each driver ran against a *child* handoff path, not the parent's.
    expect(seen).toHaveLength(2);
    for (const path of seen) {
      expect(path).not.toContain(parent.sessionId);
    }
    const childIds = children.map((c) => c.sessionId);
    expect(seen.some((p) => childIds.some((id) => p.includes(id)))).toBe(true);
  });

  it("stays on the parent session when subSessions is off", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-fanout-"));
    initGit(tmp);
    const store = new SessionStore({ rootDir: tmp });
    const parent = await store.start("build frontend and backend");
    const steps: RunStep[] = [
      { id: "implement-frontend", task: "frontend", harness: "cursor", reason: "ability-match", wave: 0, status: "pending" },
      { id: "implement-backend", task: "backend", harness: "codex", reason: "ability-match", wave: 0, status: "pending" },
    ];
    const state = initRunState(parent.goal, parent.sessionId, steps);

    const seen: string[] = [];
    await executePlan({
      cwd: tmp,
      state,
      store,
      registry,
      failover: ["cursor", "codex"],
      subSessions: false,
      createDriver: makeFakeDriver(seen),
    });

    expect(await store.listChildren(parent.sessionId)).toHaveLength(0);
    for (const path of seen) expect(path).toContain(parent.sessionId);
  });
});
