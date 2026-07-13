import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOGIN_ARGS, readAuthState, recordAuth } from "./auth.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("auth state", () => {
  it("starts empty and records a successful login", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-auth-"));
    expect((await readAuthState(tmp)).harnesses).toEqual({});

    await recordAuth(tmp, "codex", true);
    const state = await readAuthState(tmp);
    expect(state.harnesses.codex?.authenticated).toBe(true);
    expect(state.harnesses.codex?.at).toBeDefined();
    expect(state.harnesses.codex?.method).toBe("native-cli");
  });

  it("records a failed login without a timestamp", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-auth-"));
    await recordAuth(tmp, "pi", false);
    const state = await readAuthState(tmp);
    expect(state.harnesses.pi?.authenticated).toBe(false);
    expect(state.harnesses.pi?.at).toBeUndefined();
  });

  it("has default login args for every harness", () => {
    for (const id of ["claude-code", "codex", "cursor", "pi", "antigravity"] as const) {
      expect(DEFAULT_LOGIN_ARGS[id]).toBeDefined();
    }
    // CLIs with a dedicated login/auth subcommand.
    for (const id of ["claude-code", "codex", "cursor", "pi"] as const) {
      expect(DEFAULT_LOGIN_ARGS[id].length).toBeGreaterThan(0);
    }
    // Antigravity signs in via its bare interactive launch — no login subcommand.
    expect(DEFAULT_LOGIN_ARGS.antigravity).toEqual([]);
  });
});
