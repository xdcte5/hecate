import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Registry, SessionPolicy } from "@relay/schema";
import {
  BlendedRouter,
  effectiveBlendWeights,
  normalizeCostScores,
  normalizeHeuristicScores,
} from "./blended-router.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: ["architecture", "refactoring"],
      weaknesses: [],
      binaries: ["claude"],
      models: [{ id: "claude-opus-4-6", strengths: ["architecture"], weaknesses: [] }],
    },
    {
      id: "codex",
      strengths: ["unit tests", "test generation"],
      weaknesses: [],
      binaries: ["codex"],
      models: [
        { id: "o4-mini", strengths: ["unit tests"], weaknesses: [] },
        { id: "o3", strengths: ["api design"], weaknesses: [] },
      ],
    },
    {
      id: "cursor",
      strengths: ["react", "frontend", "ui"],
      weaknesses: [],
      binaries: ["cursor-agent"],
      models: [{ id: "composer-2", strengths: ["frontend"], weaknesses: [] }],
    },
    {
      id: "pi",
      strengths: ["implementation", "scripts", "cli"],
      weaknesses: [],
      binaries: ["pi"],
      models: [
        { id: "gpt-4o", strengths: ["scripts"], weaknesses: [] },
        { id: "claude-sonnet-4-6", strengths: ["implementation"], weaknesses: [] },
      ],
    },
  ],
};

const policy: SessionPolicy = {
  routing: [],
  failover: ["pi", "cursor", "claude-code", "codex"],
  routing_config: {
    mode: "auto",
    min_local_samples: 3,
    min_success_rate: 0.3,
    blend: { local: 0.5, benchmark: 0.25, heuristic: 0.25, cost: 0.15 },
  },
};

const priorsYaml = `
version: "1"
task_types:
  test:
    codex: 0.7
    codex/o4-mini: 0.95
    pi: 0.2
    cursor: 0.4
  implement:
    pi: 0.9
    cursor: 0.5
    codex: 0.3
signal_adjustments:
  - signal: test
    adjustment: 0.05
    target: codex
`;

async function writeBlendedFixture(options: {
  statsLines?: string[];
  priors?: string;
}) {
  const dir = join(tmpdir(), `relay-blended-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "relay"), { recursive: true });
  await mkdir(join(dir, ".relay"), { recursive: true });
  await writeFile(join(dir, "relay", "routing-priors.yaml"), options.priors ?? priorsYaml, "utf8");
  await writeFile(
    join(dir, ".relay", "routing-stats.jsonl"),
    `${(options.statsLines ?? []).join("\n")}${options.statsLines?.length ? "\n" : ""}`,
    "utf8",
  );
  return dir;
}

const baseOutcome = {
  ts: "2026-07-14T00:00:00.000Z",
  sessionId: "s1",
  stepId: "step-1",
  task: "write unit tests",
};

describe("effectiveBlendWeights", () => {
  const blend = { local: 0.5, benchmark: 0.25, heuristic: 0.25, cost: 0.15 };

  it("redistributes local weight when local is unavailable", () => {
    expect(effectiveBlendWeights(blend, false, true)).toEqual({
      local: 0,
      benchmark: 0.4423076923076923,
      heuristic: 0.4423076923076923,
      cost: 0.2653846153846154,
    });
  });

  it("redistributes cost weight when cost is unavailable", () => {
    expect(effectiveBlendWeights(blend, true, false)).toEqual({
      local: 0.575,
      benchmark: 0.2875,
      heuristic: 0.2875,
      cost: 0,
    });
  });

  it("keeps weights when local and cost are available", () => {
    expect(effectiveBlendWeights(blend, true, true)).toEqual(blend);
  });
});

describe("normalizeHeuristicScores", () => {
  it("maps raw scores to 0-1", () => {
    const normalized = normalizeHeuristicScores(
      new Map([
        ["codex", 8],
        ["cursor", 2],
      ]),
    );

    expect(normalized.get("codex")).toBe(1);
    expect(normalized.get("cursor")).toBe(0);
  });
});

describe("normalizeCostScores", () => {
  it("maps lower median cost to higher score", () => {
    const normalized = normalizeCostScores(
      new Map([
        ["codex", 0.5],
        ["pi", 0.1],
      ]),
    );

    expect(normalized.get("pi")).toBe(1);
    expect(normalized.get("codex")).toBe(0);
  });
});

describe("BlendedRouter", () => {
  it("blends local, benchmark, and heuristic scores", async () => {
    const cwd = await writeBlendedFixture({
      statsLines: [
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "", ok: true }),
      ],
    });

    const router = new BlendedRouter(registry, policy, cwd);
    const result = router.routeTaskBlended("write unit tests for auth", "test");

    expect(result.harness).toBe("codex");
    expect(result.reason).toBe("blended");
    expect(result.breakdown.local).toBe(1);
    expect(result.breakdown.benchmark).toBeCloseTo(0.75, 2);
    expect(result.breakdown.heuristic).toBeGreaterThan(0);
    expect(result.breakdown.blended).toBeGreaterThan(0.5);
  });

  it("redistributes local weight on cold start", async () => {
    const cwd = await writeBlendedFixture({ statsLines: [] });
    const router = new BlendedRouter(registry, policy, cwd);
    const result = router.routeTaskBlended("write unit tests for auth", "test");

    expect(result.breakdown.local).toBeNull();
    expect(result.breakdown.benchmark).toBeCloseTo(0.75, 2);
    expect(result.harness).toBe("codex");
  });

  it("uses failover order to break blended ties", async () => {
    const tiedPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "cursor", "codex", "claude-code"],
      routing_config: policy.routing_config,
    };
    const tiedRegistry: Registry = {
      harnesses: [
        { id: "pi", strengths: ["alpha"], weaknesses: [], binaries: ["pi"] },
        { id: "cursor", strengths: ["alpha"], weaknesses: [], binaries: ["cursor-agent"] },
      ],
    };
    const tiedPriors = `
version: "1"
task_types:
  general:
    pi: 0.5
    cursor: 0.5
`;
    const cwd = await writeBlendedFixture({ priors: tiedPriors, statsLines: [] });
    const router = new BlendedRouter(tiedRegistry, tiedPolicy, cwd);
    const result = router.routeTaskBlended("do alpha work", "general");

    expect(result.harness).toBe("pi");
  });

  it("review step prefers claude-code even when failover lists pi first", async () => {
    const reviewPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "cursor", "codex", "claude-code"],
      routing_config: policy.routing_config,
      step_routing: {
        review: { prefer: ["claude-code"] },
      },
    };
    const reviewRegistry: Registry = {
      harnesses: [
        { id: "pi", strengths: ["alpha"], weaknesses: [], binaries: ["pi"] },
        { id: "claude-code", strengths: ["alpha"], weaknesses: [], binaries: ["claude"] },
      ],
    };
    const reviewPriors = `
version: "1"
task_types:
  review:
    pi: 0.5
    claude-code: 0.5
`;
    const cwd = await writeBlendedFixture({ priors: reviewPriors, statsLines: [] });
    const router = new BlendedRouter(reviewRegistry, reviewPolicy, cwd);
    const result = router.routeTaskBlended("security review of auth module", "review");

    expect(result.harness).toBe("claude-code");
  });

  it("applies signal adjustments to benchmark priors", async () => {
    const cwd = await writeBlendedFixture({ statsLines: [] });
    const router = new BlendedRouter(registry, policy, cwd);
    const result = router.routeTaskBlended("write unit tests", "test");

    expect(result.breakdown.benchmark).toBeCloseTo(0.75, 2);
  });

  it("filters to installed harnesses", async () => {
    const cwd = await writeBlendedFixture({ statsLines: [] });
    const router = new BlendedRouter(registry, policy, cwd, {
      installedHarnesses: ["pi"],
    });
    const result = router.routeTaskBlended("write unit tests", "test");

    expect(result.harness).toBe("pi");
  });

  it("filters pi models by auth providers", async () => {
    const cwd = await writeBlendedFixture({ statsLines: [] });
    const router = new BlendedRouter(registry, policy, cwd, {
      piAuthProviders: new Set(["openai"]),
    });
    const result = router.routeModelBlended("create shell script", "script", "pi");

    expect(result.modelId).toBe("gpt-4o");
  });

  it("uses listed Pi models before static registry models in blended routing", async () => {
    const cwd = await writeBlendedFixture({ statsLines: [] });
    const router = new BlendedRouter(registry, policy, cwd, {
      piAuthProviders: new Set(["openai-codex"]),
      piListedModels: [
        { provider: "openai-codex", modelId: "gpt-5.4-mini", spec: "openai-codex/gpt-5.4-mini" },
        { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
      ],
    });

    const result = router.routeModelBlended("build a file writer", "implement", "pi");

    expect(result.modelId).toBe("openai-codex/gpt-5.4");
    expect(result.reason).toBe("auth-match");
  });

  it("defers codex blended model routing to the local CLI default", async () => {
    const cwd = await writeBlendedFixture({
      statsLines: [
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", model: "o4-mini", ok: true }),
      ],
    });
    const router = new BlendedRouter(registry, policy, cwd);
    const result = router.routeModelBlended("write unit tests", "test", "codex");

    expect(result.modelId).toBeUndefined();
    expect(result.reason).toBe("ability-match");
  });

  it("prefers lower-cost harness when cost samples exist", async () => {
    const costPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "codex"],
      routing_config: {
        mode: "auto",
        min_local_samples: 3,
        min_success_rate: 0.3,
        blend: { local: 0, benchmark: 0.35, heuristic: 0, cost: 0.65 },
      },
    };
    const costRegistry: Registry = {
      harnesses: [
        { id: "pi", strengths: ["alpha"], weaknesses: [], binaries: ["pi"] },
        { id: "codex", strengths: ["alpha"], weaknesses: [], binaries: ["codex"] },
      ],
    };
    const costPriors = `
version: "1"
task_types:
  test:
    pi: 0.5
    codex: 0.5
`;
    const cwd = await writeBlendedFixture({
      priors: costPriors,
      statsLines: [
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "codex",
          ok: true,
          verifyOk: true,
          costUsd: 0.5,
        }),
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "codex",
          ok: true,
          verifyOk: true,
          costUsd: 0.5,
        }),
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "codex",
          ok: true,
          verifyOk: true,
          costUsd: 0.5,
        }),
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "pi",
          ok: true,
          verifyOk: true,
          costUsd: 0.05,
        }),
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "pi",
          ok: true,
          verifyOk: true,
          costUsd: 0.05,
        }),
        JSON.stringify({
          ...baseOutcome,
          taskType: "test",
          harness: "pi",
          ok: true,
          verifyOk: true,
          costUsd: 0.05,
        }),
      ],
    });

    const router = new BlendedRouter(costRegistry, costPolicy, cwd);
    const result = router.routeTaskBlended("alpha task", "test");

    expect(result.harness).toBe("pi");
    expect(result.breakdown.cost).toBe(1);
  });

  it("excludes harnesses below min_success_rate when enough local samples exist", async () => {
    const confidencePolicy: SessionPolicy = {
      routing: [],
      failover: ["codex", "pi"],
      routing_config: {
        mode: "auto",
        min_local_samples: 3,
        min_success_rate: 0.3,
        blend: { local: 0.7, benchmark: 0.3, heuristic: 0, cost: 0 },
      },
    };
    const confidenceRegistry: Registry = {
      harnesses: [
        { id: "pi", strengths: ["alpha"], weaknesses: [], binaries: ["pi"] },
        { id: "codex", strengths: ["alpha"], weaknesses: [], binaries: ["codex"] },
      ],
    };
    const confidencePriors = `
version: "1"
task_types:
  test:
    codex: 0.95
    pi: 0.2
`;
    const cwd = await writeBlendedFixture({
      priors: confidencePriors,
      statsLines: [
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "codex", ok: false }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "pi", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "pi", ok: true }),
        JSON.stringify({ ...baseOutcome, taskType: "test", harness: "pi", ok: true }),
      ],
    });

    const router = new BlendedRouter(confidenceRegistry, confidencePolicy, cwd);
    const result = router.routeTaskBlended("write unit tests", "test");

    expect(result.harness).toBe("pi");
    expect(result.breakdown.local).toBe(1);
  });
});
