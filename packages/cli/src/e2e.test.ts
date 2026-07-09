import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cli = join(fileURLToPath(new URL(".", import.meta.url)), "../dist/index.js");
const fixtureRelay = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay/relay",
);

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function run(cwd: string, args: string[]): string {
  return execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" });
}
function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/**
 * Cross-track E2E: Dev A session/handoff + Dev B build/inject/doctor.
 * session start → record decision → build --all → HANDOFF injected in every
 * harness → doctor clean → handoff to another harness → rebuild.
 */
describe("E2E: session → build → inject → doctor → handoff (both tracks)", () => {
  it("injects the active session into all 4 harnesses and stays drift-clean", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-e2e-cli-"));
    cpSync(fixtureRelay, join(tmp, "relay"), { recursive: true });
    git(tmp, ["init", "--template="]);
    git(tmp, ["config", "user.email", "e2e@test.local"]);
    git(tmp, ["config", "user.name", "E2E"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "init"]);

    // Dev A: start a session.
    const start = run(tmp, ["session", "start", "fix React component"]);
    expect(start).toContain("Session started");

    // Dev B: build all harnesses; the active session is injected.
    const build = run(tmp, ["build", "--all"]);
    expect(build).toContain("Injected active session");

    const claude = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
    const agents = readFileSync(join(tmp, "AGENTS.md"), "utf8"); // Codex + Pi
    const cursor = readFileSync(join(tmp, ".cursor/rules/main.mdc"), "utf8");
    for (const content of [claude, agents, cursor]) {
      expect(content).toMatch(/\.relay\/sessions\/.+\/HANDOFF\.md/);
    }

    // Dev B: doctor finds no generated-file drift.
    expect(run(tmp, ["doctor"])).toContain("no generated-file drift");

    // Dev A: hand off to Codex, then Dev B rebuilds cleanly.
    run(tmp, ["handoff", "--to", "codex"]);
    expect(run(tmp, ["build", "--all"])).toContain("tracked harness");
    expect(run(tmp, ["doctor"])).toContain("no generated-file drift");
  });
});
