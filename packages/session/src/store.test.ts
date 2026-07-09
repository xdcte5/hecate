import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { RhpV1Schema } from "@relay/schema";
import { SessionStore } from "./store.js";
import { eventsPath, sessionPath } from "./paths.js";

describe("SessionStore", () => {
  it("start creates session.json, events, and relay.yaml pointer", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "relay-session-"));
    const relayDir = path.join(rootDir, "relay");
    mkdirSync(relayDir, { recursive: true });
    writeFileSync(path.join(relayDir, "relay.yaml"), "version: \"1\"\n");

    const store = new SessionStore({ rootDir });
    const session = await store.start("ship sprint 1");

    const filePath = sessionPath(rootDir, session.sessionId);
    expect(existsSync(filePath)).toBe(true);

    const parsed = RhpV1Schema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    expect(parsed.sessionId).toBe(session.sessionId);
    expect(parsed.goal).toBe("ship sprint 1");
    expect(parsed.status).toBe("active");

    const events = readFileSync(eventsPath(rootDir, session.sessionId), "utf8");
    expect(events).toContain("session_started");

    const relayYaml = parseYaml(readFileSync(path.join(relayDir, "relay.yaml"), "utf8")) as {
      activeSessionId?: string;
    };
    expect(relayYaml.activeSessionId).toBe(session.sessionId);
  });
});
