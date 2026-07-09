import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { emptyRhpV1 } from "@relay/schema";
import { validateSession } from "./validate-session.js";
import {
  eventsPath,
  handoffMdPath,
  handoffPath,
  sessionDir,
  sessionPath,
} from "./paths.js";

describe("validateSession", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeValidSession(sessionId: string, handoffSeq = 0): void {
    const session = emptyRhpV1(sessionId, "test goal", "cursor");
    session.handoffSeq = handoffSeq;
    mkdirSync(sessionDir(tmpDir, sessionId), { recursive: true });
    writeFileSync(sessionPath(tmpDir, sessionId), JSON.stringify(session, null, 2));
    writeFileSync(
      eventsPath(tmpDir, sessionId),
      `${JSON.stringify({ event: "session_started", at: new Date().toISOString() })}\n`,
    );
    if (handoffSeq > 0) {
      writeFileSync(handoffPath(tmpDir, sessionId), "{}");
      writeFileSync(handoffMdPath(tmpDir, sessionId), "# Handoff\n");
    }
  }

  it("passes for a valid session with events", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-validate-"));
    const sessionId = "sess-valid";
    writeValidSession(sessionId);

    const result = await validateSession(tmpDir, sessionId);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.session?.sessionId).toBe(sessionId);
  });

  it("fails when session.json has invalid schema", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-validate-"));
    const sessionId = "sess-bad-schema";
    mkdirSync(sessionDir(tmpDir, sessionId), { recursive: true });
    writeFileSync(sessionPath(tmpDir, sessionId), JSON.stringify({ bad: true }));
    writeFileSync(
      eventsPath(tmpDir, sessionId),
      `${JSON.stringify({ event: "session_started", at: new Date().toISOString() })}\n`,
    );

    const result = await validateSession(tmpDir, sessionId);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith("session.json:"))).toBe(true);
  });

  it("fails when handoffSeq > 0 but handoff files are missing", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-validate-"));
    const sessionId = "sess-missing-handoff";
    writeValidSession(sessionId, 1);
    rmSync(handoffPath(tmpDir, sessionId));
    rmSync(handoffMdPath(tmpDir, sessionId));

    const result = await validateSession(tmpDir, sessionId);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("handoff.json"))).toBe(true);
    expect(result.errors.some((e) => e.includes("HANDOFF.md"))).toBe(true);
  });

  it("fails when events.jsonl is missing or empty", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "relay-validate-"));
    const sessionId = "sess-no-events";
    writeValidSession(sessionId);
    writeFileSync(eventsPath(tmpDir, sessionId), "\n");

    const result = await validateSession(tmpDir, sessionId);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("events.jsonl"))).toBe(true);
    expect(existsSync(eventsPath(tmpDir, sessionId))).toBe(true);
    expect(readFileSync(eventsPath(tmpDir, sessionId), "utf8").trim()).toBe("");
  });
});
