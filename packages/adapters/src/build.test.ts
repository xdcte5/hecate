import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RelayLockSchema } from "@relay/schema";
import { buildProject } from "./build.js";

const fixtureRelay = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay/relay",
);

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function scaffold(): string {
  tmp = mkdtempSync(join(os.tmpdir(), "relay-build-"));
  cpSync(fixtureRelay, join(tmp, "relay"), { recursive: true });
  return tmp;
}

describe("buildProject", () => {
  it("writes all 4 harnesses + a schema-valid relay.lock", async () => {
    const root = scaffold();
    const result = await buildProject(root);

    expect(Object.keys(result.filesByHarness).sort()).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "pi",
    ]);
    expect(() => RelayLockSchema.parse(result.lock)).not.toThrow();
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor/rules/main.mdc"))).toBe(true);
    expect(existsSync(join(root, "relay.lock"))).toBe(true);
  });

  it("injects the active session pointer into instruction files", async () => {
    const root = scaffold();
    const pointer = ".relay/sessions/xyz/HANDOFF.md";
    await buildProject(root, { context: { handoffPointer: pointer } });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(pointer);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(pointer);
  });

  it("rejects a conflicting AGENTS.md between Codex and Pi", async () => {
    const root = scaffold();
    // Diverge Codex's instructions from the shared base → AGENTS.md conflict.
    writeFileSync(join(root, "relay/instructions.codex.md"), "# codex only\n");
    await expect(buildProject(root)).rejects.toThrow(/Conflicting output for AGENTS\.md/);
  });

  it("writes Pi globally and omits it from relay.lock with --pi-global", async () => {
    const root = scaffold();
    const home = join(root, "home");
    const result = await buildProject(root, { piGlobalHome: home });

    expect(existsSync(join(home, "AGENTS.md"))).toBe(true);
    expect(result.lock.adapters.map((a) => a.harness)).not.toContain("pi");
    // Other harnesses stay tracked in the repo.
    expect(result.lock.adapters.map((a) => a.harness)).toContain("claude-code");
  });
});
