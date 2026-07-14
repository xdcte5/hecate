import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import { buildRunPlan } from "./plan.js";
import { listChangedFiles, resolveTestCommand, runTestGate, verifyImplementWave } from "./verify.js";

const fixtureRoot = join(import.meta.dirname, "../../../fixtures/minimal-relay");

describe("buildRunPlan parallel waves", () => {
  it("splits frontend+backend goals into parallel wave 0", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const plan = buildRunPlan(
      "add login page with JWT auth API and database backend",
      router,
    );

    const wave0 = plan.steps.filter((step) => step.wave === 0);
    expect(wave0).toHaveLength(2);
    expect(wave0.map((step) => step.id)).toEqual(
      expect.arrayContaining(["implement-frontend", "implement-backend"]),
    );

    const wave1 = plan.steps.filter((step) => step.wave === 1);
    expect(wave1.length).toBe(0);
  });
});

describe("verifyImplementWave", () => {
  it("blocks follow-up wave when no files changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");

    const result = await verifyImplementWave(dir);
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("passes when git reports changed files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("git", ["init"], { cwd: dir });
    await writeFile(join(dir, "app.ts"), "export {};\n");

    const files = await listChangedFiles(dir);
    expect(files.length).toBeGreaterThan(0);

    const result = await verifyImplementWave(dir, { testCommand: null });
    expect(result.ok).toBe(true);
  });
});

describe("resolveTestCommand", () => {
  it("prefers explicit override and env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    expect(await resolveTestCommand(dir, { testCommand: "npm test" })).toBe("npm test");

    const prev = process.env.RELAY_VERIFY_TEST_COMMAND;
    process.env.RELAY_VERIFY_TEST_COMMAND = "pnpm vitest run";
    expect(await resolveTestCommand(dir)).toBe("pnpm vitest run");
    if (prev === undefined) delete process.env.RELAY_VERIFY_TEST_COMMAND;
    else process.env.RELAY_VERIFY_TEST_COMMAND = prev;
  });

  it("auto-detects pnpm test from package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    expect(await resolveTestCommand(dir, { testCommand: undefined })).toBe("pnpm test");
  });

  it("respects session policy disable flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    expect(
      await resolveTestCommand(dir, {
        sessionPolicy: { routing: [], failover: ["pi"], verification: { enableTestGate: false } },
      }),
    ).toBeNull();
  });
});

describe("runTestGate", () => {
  it("runs a shell command in cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    const result = await runTestGate(dir, "echo ok");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Tests passed");
  });

  it("reports failure for non-zero exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-verify-"));
    const result = await runTestGate(dir, "exit 1");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Test gate failed");
  });
});
