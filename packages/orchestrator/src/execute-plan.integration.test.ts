import { cpSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRelayConfig } from "@relay/registry";
import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { executePlan } from "./execute-plan.js";
import * as factory from "./drivers/factory.js";
import { MockHarnessDriver } from "./drivers/mock.js";
import type { HarnessDriver } from "./drivers/types.js";
import { initRunState } from "./runner-state.js";
import type { RunStep } from "./types.js";

const detectInstalledBinaries = vi.hoisted(() => vi.fn());

vi.mock("@relay/adapters", () => ({
  detectInstalledBinaries,
  buildProject: vi.fn().mockResolvedValue(undefined),
}));

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

const piNotAuthedCtx = {
  installed: ["pi", "claude-code", "codex"] as HarnessId[],
  piAuthProviders: new Set(["openai-codex"]),
  piListedModels: [
    {
      provider: "azure-openai-responses",
      modelId: "gpt-4",
      spec: "azure-openai-responses/gpt-4",
    },
  ],
};

function makeStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: "run",
    task: "create hello.sh printing hello",
    harness: "pi",
    reason: "ability-match",
    wave: 0,
    status: "pending",
    ...overrides,
  };
}

async function seedWorkspace(cwd: string): Promise<void> {
  await mkdir(join(cwd, "relay"), { recursive: true });
  cpSync(join(fixtureRoot, "relay"), join(cwd, "relay"), { recursive: true });

  writeFileSync(
    join(cwd, "relay", "session-policy.yaml"),
    `routing: []
failover:
  - pi
  - claude-code
  - codex
governance:
  requireGitSnapshotOnHandoff: true
  maxHandoffTokens: 8000
  maxTranscriptLines: 200
`,
    "utf8",
  );
}

describe("execute-plan integration", () => {
  let createDriverSpy: ReturnType<typeof vi.spyOn>;
  let previousMockEnv: string | undefined;

  beforeEach(() => {
    previousMockEnv = process.env.RELAY_MOCK_DRIVER;
    process.env.RELAY_MOCK_DRIVER = "1";
    createDriverSpy = vi.spyOn(factory, "createDriver");
    detectInstalledBinaries.mockReset();
    detectInstalledBinaries.mockImplementation(async (binaries: string[]) => {
      const name = binaries[0];
      if (name === "pi") return ["/usr/local/bin/pi"];
      if (name === "claude") return ["relay-mock"];
      if (name === "codex") return ["relay-mock"];
      return [];
    });
  });

  afterEach(() => {
    createDriverSpy.mockRestore();
    if (previousMockEnv === undefined) delete process.env.RELAY_MOCK_DRIVER;
    else process.env.RELAY_MOCK_DRIVER = previousMockEnv;
  });

  it("does not spawn Pi when auth preflight fails and fails over to next runnable harness", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-no-pi-"));
    try {
      await seedWorkspace(cwd);
      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const store = new SessionStore({ rootDir: cwd });
      const session = await store.start("create hello.sh printing hello");

      const state = initRunState(session.goal, session.sessionId, [makeStep()]);
      const lines: string[] = [];

      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        eligibilityCtx: piNotAuthedCtx,
        piAuthProviders: piNotAuthedCtx.piAuthProviders,
        piListedModels: piNotAuthedCtx.piListedModels,
        sessionPolicy,
        onLine: (line) => lines.push(line),
      });

      expect(result.ok).toBe(true);
      expect(state.steps[0]?.status).toBe("done");
      expect(state.steps[0]?.harness).toBe("claude-code");
      expect(state.steps[0]?.harness).not.toBe("pi");

      const spawnedHarnesses = createDriverSpy.mock.calls.map(([harness]: [HarnessId, string]) => harness);
      expect(spawnedHarnesses).not.toContain("pi");
      expect(spawnedHarnesses).toContain("claude-code");

      const joined = lines.join("\n");
      expect(joined).toMatch(/Skipped non-runnable harnesses:.*Pi/i);
      expect(joined).toMatch(/Planned Pi — not runnable/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails without spawning Pi when no runnable harness remains after auth preflight", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-no-runnable-"));
    try {
      delete process.env.RELAY_MOCK_DRIVER;
      await seedWorkspace(cwd);
      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const store = new SessionStore({ rootDir: cwd });
      const session = await store.start("create hello.sh printing hello");

      detectInstalledBinaries.mockResolvedValue([]);

      const state = initRunState(session.goal, session.sessionId, [makeStep()]);
      const lines: string[] = [];

      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: ["pi", "claude-code", "codex"],
        eligibilityCtx: piNotAuthedCtx,
        piAuthProviders: piNotAuthedCtx.piAuthProviders,
        piListedModels: piNotAuthedCtx.piListedModels,
        sessionPolicy,
        onLine: (line) => lines.push(line),
      });

      expect(result.ok).toBe(false);
      expect(state.steps[0]?.status).toBe("failed");
      expect(state.steps[0]?.error).toMatch(/No runnable agent found/i);

      const spawnedHarnesses = createDriverSpy.mock.calls.map(([harness]: [HarnessId, string]) => harness);
      expect(spawnedHarnesses).toHaveLength(0);

      expect(lines.join("\n")).toMatch(/No runnable agent found/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("re-routes model on failover retry instead of keeping the failed harness model", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-failover-model-"));
    try {
      await seedWorkspace(cwd);
      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const store = new SessionStore({ rootDir: cwd });
      const session = await store.start("create hello.sh printing hello");

      const mockDriver = new MockHarnessDriver();
      createDriverSpy.mockImplementation((harness: HarnessId): HarnessDriver => ({
        kind: "mock",
        streamEvents: (handler) => mockDriver.streamEvents(handler),
        cancel: () => mockDriver.cancel(),
        run: async (request) => {
          if (request.harness === "pi") {
            return { ok: false, harness: "pi", summary: "Pi runtime auth failure" };
          }
          return mockDriver.run(request);
        },
      }));

      const state = initRunState(session.goal, session.sessionId, [
        makeStep({ model: "gpt-4o", modelReason: "ability-match" }),
      ]);
      const lines: string[] = [];

      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        eligibilityCtx: {
          installed: ["pi", "claude-code", "codex"],
          piAuthProviders: new Set(["openai"]),
          piListedModels: [{ provider: "openai", modelId: "gpt-4o", spec: "openai/gpt-4o" }],
        },
        sessionPolicy,
        onLine: (line) => lines.push(line),
      });

      expect(result.ok).toBe(true);
      expect(state.steps[0]?.harness).toBe("claude-code");
      expect(state.steps[0]?.model).not.toBe("gpt-4o");
      expect(state.steps[0]?.model).toMatch(/claude-/);

      const spawnedHarnesses = createDriverSpy.mock.calls.map(([harness]: [HarnessId, string]) => harness);
      expect(spawnedHarnesses).toEqual(["pi", "claude-code"]);
      expect(lines.join("\n")).toMatch(/retrying with claude-code/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("retries the same worker when step verifiers fail before marking the step done", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-verify-retry-"));
    try {
      await seedWorkspace(cwd);
      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const store = new SessionStore({ rootDir: cwd });
      const session = await store.start("create hello.sh printing hello");
      const events: Array<{ type: string; [key: string]: unknown }> = [];
      let attempts = 0;

      createDriverSpy.mockImplementation((harness: HarnessId): HarnessDriver => ({
        kind: "mock",
        streamEvents: () => () => undefined,
        cancel: () => undefined,
        run: async (request) => {
          attempts += 1;
          await writeFile(
            join(request.cwd, "hello.sh"),
            attempts === 1 ? "echo goodbye\n" : "echo hello\n",
            "utf8",
          );
          return {
            ok: true,
            harness,
            summary: `attempt ${attempts}`,
            output: `attempt ${attempts}`,
            filesTouched: ["hello.sh"],
          };
        },
      }));

      const state = initRunState(session.goal, session.sessionId, [
        makeStep({
          verify: [{ type: "shell", command: "bash hello.sh", expectStdout: "hello\n" }],
        }),
      ]);

      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        eligibilityCtx: {
          installed: ["pi", "claude-code", "codex"],
          piAuthProviders: new Set(["openai"]),
          piListedModels: [],
        },
        sessionPolicy,
        onEvent: (event) => events.push(event),
      });

      expect(result.ok).toBe(true);
      expect(attempts).toBe(2);
      expect(state.steps[0]?.status).toBe("done");
      expect(state.steps[0]?.verifyRetries).toBe(1);
      expect(events.filter((event) => event.type === "verify_outcome").map((event) => event.ok)).toEqual([
        false,
        true,
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
