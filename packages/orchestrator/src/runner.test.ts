import { cp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SessionStore } from "@relay/session";
import { initRunState, saveRunState } from "./runner-state.js";
import { runOrchestration } from "./runner.js";
import type { RunStep } from "./types.js";

const execFileAsync = promisify(execFile);

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

async function createFixtureRepo(): Promise<string> {
  const cwd = join(tmpdir(), `relay-runner-${Date.now()}-${Math.random()}`);
  await mkdir(cwd, { recursive: true });
  await cp(join(fixtureRoot, "relay"), join(cwd, "relay"), { recursive: true });
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["config", "user.email", "relay-test@example.invalid"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Relay Test"], { cwd });
  await writeFile(join(cwd, "README.md"), "# relay runner\n", "utf8");
  await execFileAsync("git", ["add", "README.md", "relay"], { cwd });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

describe("runOrchestration resume", () => {
  it("relaunches the active running step from durable state", async () => {
    const cwd = await createFixtureRepo();
    const store = new SessionStore({ rootDir: cwd, defaultHarness: "claude-code" });
    const session = await store.start("resume active step");
    const step: RunStep = {
      id: "implement",
      task: "create resume.txt",
      harness: "claude-code",
      reason: "failover",
      wave: 0,
      status: "running",
      startedAt: "2026-08-09T00:00:00.000Z",
    };
    await saveRunState(cwd, initRunState(session.goal, session.sessionId, [step]));

    const result = await runOrchestration({
      cwd,
      mode: "clipboard",
      interactive: false,
      resume: true,
    });

    expect(result.state.steps[0]?.status).toBe("running");
    expect(result.results[0]?.message).toContain("Handoff #");
    expect(result.message).toContain("create resume.txt");
  });
});
