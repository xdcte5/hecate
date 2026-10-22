import { cpSync, writeFileSync } from "node:fs";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRelayConfig, ThinRouter } from "@relay/registry";
import type { HarnessId, RoutingOutcome } from "@relay/schema";
import { buildRunPlan } from "./plan.js";
import { filterRunnableHarnesses } from "./harness-eligibility.js";
import { resolveRoutingStatsPath } from "./routing-stats.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

function makeOutcome(harness: HarnessId, ok: boolean, verifyOk = ok): RoutingOutcome {
  return {
    ts: new Date().toISOString(),
    sessionId: "sess_stats",
    stepId: "implement",
    taskType: "implement",
    task: "build portfolio page",
    harness,
    ok,
    verifyOk,
  };
}

async function seedWorkspace(cwd: string): Promise<void> {
  await mkdir(join(cwd, "relay"), { recursive: true });
  cpSync(join(fixtureRoot, "relay"), join(cwd, "relay"), { recursive: true });

  const policyPath = join(cwd, "relay", "session-policy.yaml");
  writeFileSync(
    policyPath,
    `routing: []
routing_config:
  mode: auto
  min_local_samples: 5
  blend:
    local: 0.85
    benchmark: 0.1
    heuristic: 0.05
failover:
  - pi
  - cursor
  - claude-code
  - codex
governance:
  requireGitSnapshotOnHandoff: true
  maxHandoffTokens: 8000
  maxTranscriptLines: 200
`,
    "utf8",
  );

  const outcomes: RoutingOutcome[] = [
    makeOutcome("pi", true),
    makeOutcome("pi", true),
    makeOutcome("pi", true),
    makeOutcome("pi", true),
    makeOutcome("pi", true),
    makeOutcome("cursor", false, false),
    makeOutcome("cursor", false, false),
    makeOutcome("cursor", true),
  ];

  await mkdir(join(cwd, ".relay"), { recursive: true });
  await writeFile(
    resolveRoutingStatsPath(cwd),
    `${outcomes.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
}

describe("routing integration", () => {
  it("blended router prefers pi when local implement stats favor it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-blend-"));
    try {
      await seedWorkspace(cwd);

      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const router = new ThinRouter(registry, sessionPolicy, {}, cwd);
      const plan = buildRunPlan("scaffold a cli tool for nightly database backups", router);

      expect(plan.steps[0]?.harness).toBe("pi");
      expect(plan.steps[0]?.routeReason).toBe("blended");
      expect(plan.steps[0]?.routeBreakdown?.local).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("plan does not select Pi when Pi is not auth-runnable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-no-pi-"));
    try {
      await mkdir(join(cwd, "relay"), { recursive: true });
      cpSync(join(fixtureRoot, "relay"), join(cwd, "relay"), { recursive: true });

      const policyPath = join(cwd, "relay", "session-policy.yaml");
      writeFileSync(
        policyPath,
        `routing: []
routing_config:
  mode: heuristic
failover:
  - cursor
  - claude-code
  - codex
governance:
  requireGitSnapshotOnHandoff: true
  maxHandoffTokens: 8000
  maxTranscriptLines: 200
`,
        "utf8",
      );

      const { registry, sessionPolicy } = await loadRelayConfig(cwd);
      const runnableFailover = filterRunnableHarnesses(sessionPolicy.failover, {
        installed: ["pi", "cursor", "claude-code", "codex"],
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [
          {
            provider: "azure-openai-responses",
            modelId: "gpt-4",
            spec: "azure-openai-responses/gpt-4",
          },
        ],
      });

      expect(runnableFailover).not.toContain("pi");

      const router = new ThinRouter(
        registry,
        { ...sessionPolicy, failover: runnableFailover },
        {
          piAuthProviders: new Set(["openai-codex"]),
          piListedModels: [
            {
              provider: "azure-openai-responses",
              modelId: "gpt-4",
              spec: "azure-openai-responses/gpt-4",
            },
          ],
          installedHarnesses: ["pi", "cursor", "claude-code", "codex"],
        },
        cwd,
      );
      const plan = buildRunPlan("create hello.sh printing hello", router, {
        ...sessionPolicy,
        failover: runnableFailover,
      });

      expect(plan.steps[0]?.harness).not.toBe("pi");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
