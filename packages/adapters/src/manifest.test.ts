import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayLockSchema } from "@relay/schema";
import type { GeneratedFile } from "./adapter.js";
import {
  buildAdapterManifest,
  buildRelayLock,
  detectDrift,
  readRelayLock,
  sha256,
  writeGeneratedFiles,
  writeRelayLock,
} from "./manifest.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const files: GeneratedFile[] = [
  { path: "CLAUDE.md", content: "# hi\n" },
  { path: ".claude/agents/reviewer.md", content: "reviewer\n" },
];

describe("buildAdapterManifest", () => {
  it("checksums and sorts entries by path", () => {
    const manifest = buildAdapterManifest("claude-code", files);
    expect(manifest.files.map((f) => f.path)).toEqual([
      ".claude/agents/reviewer.md",
      "CLAUDE.md",
    ]);
    expect(manifest.files[1]!.sha256).toBe(sha256("# hi\n"));
  });
});

describe("relay.lock round-trip", () => {
  it("writes and reads a schema-valid lock", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-lock-"));
    const lock = buildRelayLock("0.1.0", [buildAdapterManifest("claude-code", files)]);
    await writeRelayLock(tmp, lock);
    expect(() => RelayLockSchema.parse(lock)).not.toThrow();
    const read = await readRelayLock(tmp);
    expect(read).toEqual(lock);
  });
});

describe("detectDrift", () => {
  it("is clean right after a write", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-drift-"));
    await writeGeneratedFiles(tmp, files);
    const lock = buildRelayLock("0.1.0", [buildAdapterManifest("claude-code", files)]);
    expect(await detectDrift(tmp, lock)).toEqual([]);
  });

  it("flags a modified file", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-drift-"));
    await writeGeneratedFiles(tmp, files);
    const lock = buildRelayLock("0.1.0", [buildAdapterManifest("claude-code", files)]);
    writeFileSync(join(tmp, "CLAUDE.md"), "# tampered\n");
    const drift = await detectDrift(tmp, lock);
    expect(drift).toEqual([{ harness: "claude-code", path: "CLAUDE.md", kind: "modified" }]);
    // sanity: the other file is untouched
    expect(readFileSync(join(tmp, ".claude/agents/reviewer.md"), "utf8")).toBe("reviewer\n");
  });

  it("flags a missing file", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-drift-"));
    await writeGeneratedFiles(tmp, files);
    const lock = buildRelayLock("0.1.0", [buildAdapterManifest("claude-code", files)]);
    rmSync(join(tmp, "CLAUDE.md"));
    const drift = await detectDrift(tmp, lock);
    expect(drift).toEqual([{ harness: "claude-code", path: "CLAUDE.md", kind: "missing" }]);
  });
});
