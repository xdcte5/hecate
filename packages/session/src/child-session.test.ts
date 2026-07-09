import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";
import { readEvents } from "./read-events.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("child sub-sessions (fan-out)", () => {
  it("spawns children without changing the active session, then merges back", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-child-"));
    const store = new SessionStore({ rootDir: tmp });

    const parent = await store.start("build portfolio with auth");
    const frontend = await store.startChild(parent.sessionId, "frontend", "cursor");
    const backend = await store.startChild(parent.sessionId, "backend", "codex");

    // Parent stays active; children are isolated.
    expect((await store.getActive())?.sessionId).toBe(parent.sessionId);
    expect(frontend.parentId).toBe(parent.sessionId);
    expect(backend.parentId).toBe(parent.sessionId);

    const withChildren = await store.get(parent.sessionId);
    expect(withChildren?.childIds).toEqual([frontend.sessionId, backend.sessionId]);
    expect(await store.listChildren(parent.sessionId)).toHaveLength(2);

    // Children record decisions in isolation.
    await store.recordDecision(frontend.sessionId, "Use design tokens");
    await store.recordDecision(backend.sessionId, "JWT in httpOnly cookie");

    await store.mergeChild(parent.sessionId, frontend.sessionId);
    const merged = await store.mergeChild(parent.sessionId, backend.sessionId);

    const texts = merged.decisions.map((d) => d.text);
    expect(texts).toContain("Use design tokens");
    expect(texts).toContain("JWT in httpOnly cookie");

    // Child is marked completed; merge is audited on the parent.
    expect((await store.get(frontend.sessionId))?.status).toBe("completed");
    const parentEvents = await readEvents(tmp, parent.sessionId);
    expect(parentEvents.filter((e) => e.event === "child_spawned")).toHaveLength(2);
    expect(parentEvents.filter((e) => e.event === "child_merged")).toHaveLength(2);
  });

  it("does not duplicate a decision already present on the parent", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-child-"));
    const store = new SessionStore({ rootDir: tmp });
    const parent = await store.start("goal");
    await store.recordDecision(parent.sessionId, "shared choice");

    const child = await store.startChild(parent.sessionId, "sub", "pi");
    await store.recordDecision(child.sessionId, "shared choice");
    const merged = await store.mergeChild(parent.sessionId, child.sessionId);

    expect(merged.decisions.filter((d) => d.text === "shared choice")).toHaveLength(1);
  });
});
