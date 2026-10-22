import { cpSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRelayConfig } from "@relay/registry";
import type { HarnessId } from "@relay/schema";
import { readEvents, SessionStore } from "@relay/session";
import * as factory from "./drivers/factory.js";
import type { HarnessDriver } from "./drivers/types.js";
import { executePlan } from "./execute-plan.js";
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

function makeStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: "implement",
    task: "create hello.sh printing hello",
    harness: "claude-code",
    reason: "ability-match",
    wave: 0,
    status: "pending",
    verify: [{ type: "shell", command: "bash hello.sh", expectStdout: "hello\n" }],
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
  - claude-code
  - codex
governance:
  requireGitSnapshotOnHandoff: false
`,
    "utf8",
  );
}

describe("executePlan graph verification", () => {
  let createDriverSpy: ReturnType<typeof vi.spyOn>;
  let previousGraph: string | undefined;

  beforeEach(() => {
    previousGraph = process.env.RELAY_GRAPH;
    process.env.RELAY_GRAPH = "1";
    createDriverSpy = vi.spyOn(factory, "createDriver");
    detectInstalledBinaries.mockReset();
    detectInstalledBinaries.mockResolvedValue(["relay-mock"]);
  });

  afterEach(() => {
    createDriverSpy.mockRestore();
    if (previousGraph === undefined) delete process.env.RELAY_GRAPH;
    else process.env.RELAY_GRAPH = previousGraph;
  });

  it("runs graph verifier nodes and retries failed verification before completing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-graph-"));
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

      const state = initRunState(session.goal, session.sessionId, [makeStep()]);
      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        installedAgents: ["claude-code", "codex"],
        sessionPolicy,
        onEvent: (event) => events.push(event),
      });

      expect(result.ok).toBe(true);
      expect(attempts).toBe(2);
      expect(events.filter((event) => event.type === "graph_node").map((event) => event.ok)).toEqual([
        false,
        true,
      ]);
      expect(events.filter((event) => event.type === "verify_outcome").map((event) => event.ok)).toEqual([
        false,
        true,
      ]);

      const persisted = await readEvents(cwd, session.sessionId);
      expect(persisted.map((event) => event.event)).toEqual(
        expect.arrayContaining(["graph_node", "verify_outcome"]),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails after repeated graph verifier failures exhaust the retry budget", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-graph-exhaust-"));
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
          await writeFile(join(request.cwd, "hello.sh"), `echo goodbye-${attempts}\n`, "utf8");
          return {
            ok: true,
            harness,
            summary: `attempt ${attempts}`,
            output: `attempt ${attempts}`,
            filesTouched: ["hello.sh"],
          };
        },
      }));

      const state = initRunState(session.goal, session.sessionId, [makeStep()]);
      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        installedAgents: ["claude-code", "codex"],
        sessionPolicy: {
          ...sessionPolicy,
          verification: { enableTestGate: true, maxStepRetries: 2 },
        },
        onEvent: (event) => events.push(event),
      });

      expect(result.ok).toBe(false);
      expect(attempts).toBe(3);
      expect(state.steps[0]?.status).toBe("failed");
      expect(state.steps[0]?.error).toContain("Verification blocked step");
      expect(events.filter((event) => event.type === "graph_node").map((event) => event.ok)).toEqual([
        false,
        false,
        false,
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stops early when the same verifier failure repeats twice", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-exec-graph-loop-"));
    try {
      await seedWorkspace(cwd);
      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const store = new SessionStore({ rootDir: cwd });
      const session = await store.start("create hello.sh printing hello");
      let attempts = 0;

      createDriverSpy.mockImplementation((harness: HarnessId): HarnessDriver => ({
        kind: "mock",
        streamEvents: () => () => undefined,
        cancel: () => undefined,
        run: async (request) => {
          attempts += 1;
          await writeFile(join(request.cwd, "hello.sh"), "echo goodbye\n", "utf8");
          return {
            ok: true,
            harness,
            summary: `attempt ${attempts}`,
            output: `attempt ${attempts}`,
            filesTouched: ["hello.sh"],
          };
        },
      }));

      const state = initRunState(session.goal, session.sessionId, [makeStep()]);
      const result = await executePlan({
        cwd,
        state,
        store,
        registry,
        failover: sessionPolicy.failover,
        installedAgents: ["claude-code", "codex"],
        sessionPolicy: {
          ...sessionPolicy,
          verification: { enableTestGate: true, maxStepRetries: 3 },
        },
      });

      expect(result.ok).toBe(false);
      expect(attempts).toBe(2);
      expect(state.steps[0]?.error).toContain("Repeated verifier failure");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
