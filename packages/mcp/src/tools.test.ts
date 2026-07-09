import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "@relay/session";
import { readEvents } from "@relay/session";
import {
  handoffPrepare,
  registryList,
  sessionGet,
  sessionRecordDecision,
  sessionRecordProgress,
} from "./tools.js";

const fixtureRelay = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay/relay",
);

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function project(): Promise<{ rootDir: string; sessionId: string }> {
  tmp = mkdtempSync(join(os.tmpdir(), "relay-mcp-"));
  cpSync(fixtureRelay, join(tmp, "relay"), { recursive: true });
  const store = new SessionStore({ rootDir: tmp });
  const session = await store.start("fix React component");
  return { rootDir: tmp, sessionId: session.sessionId };
}

describe("relay-mcp tools", () => {
  it("session_get returns the active session", async () => {
    const { rootDir, sessionId } = await project();
    const session = await sessionGet({ rootDir });
    expect(session.sessionId).toBe(sessionId);
    expect(session.goal).toBe("fix React component");
  });

  it("session_get throws when there is no session", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-mcp-"));
    cpSync(fixtureRelay, join(tmp, "relay"), { recursive: true });
    await expect(sessionGet({ rootDir: tmp })).rejects.toThrow(/No active session/);
  });

  it("session_record_decision persists and lands in events.jsonl", async () => {
    const { rootDir, sessionId } = await project();
    const updated = await sessionRecordDecision(
      { rootDir },
      { text: "Use design tokens", rationale: "consistency" },
    );
    expect(updated.decisions.map((d) => d.text)).toContain("Use design tokens");

    const events = await readEvents(rootDir, sessionId);
    expect(events.some((e) => e.event === "decision_recorded")).toBe(true);
  });

  it("session_record_progress records for the active harness", async () => {
    const { rootDir } = await project();
    const updated = await sessionRecordProgress(
      { rootDir },
      { summary: "wired button", filesTouched: ["Button.tsx"] },
    );
    expect(Object.keys(updated.agents).length).toBeGreaterThan(0);
  });

  it("handoff_prepare returns an RHP bundle for the target", async () => {
    const { rootDir, sessionId } = await project();
    const bundle = await handoffPrepare({ rootDir }, { to: "codex" });
    expect(bundle.targetHarness).toBe("codex");
    expect(bundle.sessionId).toBe(sessionId);
  });

  it("registry_list returns the Harness Cards", async () => {
    const { rootDir } = await project();
    const registry = await registryList({ rootDir });
    expect(registry.harnesses.map((h) => h.id)).toContain("cursor");
  });
});
