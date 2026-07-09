import { describe, expect, it } from "vitest";
import {
  AdapterManifestSchema,
  RelayLockSchema,
  emptyRelayLock,
} from "./adapter-manifest.js";

describe("AdapterManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const parsed = AdapterManifestSchema.parse({
      harness: "claude-code",
      files: [{ path: "CLAUDE.md", sha256: "a".repeat(64), bytes: 12 }],
    });
    expect(parsed.files).toHaveLength(1);
  });

  it("rejects a malformed sha256", () => {
    expect(() =>
      AdapterManifestSchema.parse({
        harness: "codex",
        files: [{ path: "AGENTS.md", sha256: "notahash", bytes: 1 }],
      }),
    ).toThrow();
  });
});

describe("RelayLockSchema", () => {
  it("round-trips an empty lock", () => {
    const lock = emptyRelayLock("0.1.0");
    expect(RelayLockSchema.parse(lock)).toEqual(lock);
    expect(lock.lockfileVersion).toBe("1");
  });
});
