import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { loadRelayConfig } from "./load-registry.js";
import { TaskRouter, routeTask } from "./task-router.js";
import { ThinRouter, selectHarness, selectHarnessDetailed } from "./thin-router.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: ["architecture", "refactoring", "complex reasoning", "system design", "debugging"],
      weaknesses: ["quick edits", "unit tests"],
      binaries: ["claude"],
    },
    {
      id: "codex",
      strengths: ["unit tests", "test generation", "api design", "typescript", "debugging"],
      weaknesses: ["ui work", "frontend styling"],
      binaries: ["codex"],
    },
    {
      id: "cursor",
      strengths: [
        "react",
        "frontend",
        "component fixes",
        "ide integration",
        "jsx",
        "tsx",
        "ui",
        "portfolio",
        "graph",
      ],
      weaknesses: ["long-running tasks", "deep architecture"],
      binaries: ["cursor-agent"],
    },
    {
      id: "pi",
      strengths: ["implementation", "greenfield", "scaffolding", "scripts", "automation", "cli", "full-stack"],
      weaknesses: ["complex refactors"],
      binaries: ["pi"],
    },
  ],
};

const policy: SessionPolicy = {
  routing: [],
  failover: ["pi", "cursor", "claude-code", "codex"],
};

const router = new ThinRouter(registry, policy);
const taskRouter = new TaskRouter(registry, policy);

describe("TaskRouter ability matching", () => {
  it("routes explicit tests to codex", () => {
    expect(taskRouter.routeTask("write unit tests for auth module")).toMatchObject({
      harness: "codex",
      reason: "ability-match",
    });
  });

  it("routes portfolio UI to cursor", () => {
    expect(
      taskRouter.routeTask("build a portfolio page with graph ui showing socials"),
    ).toMatchObject({
      harness: "cursor",
      reason: "ability-match",
    });
  });

  it("routes frontend bug fixes to cursor", () => {
    expect(taskRouter.routeTask("fix React component rendering bug")).toMatchObject({
      harness: "cursor",
      reason: "ability-match",
    });
  });

  it("routes vitest tasks to codex", () => {
    expect(taskRouter.routeTask("add vitest coverage for parser")).toMatchObject({
      harness: "codex",
      reason: "ability-match",
    });
  });

  it("routes jsx work to cursor", () => {
    expect(taskRouter.routeTask("update jsx markup in header")).toMatchObject({
      harness: "cursor",
      reason: "ability-match",
    });
  });

  it("routes refactor tasks to claude-code", () => {
    expect(taskRouter.routeTask("refactor payment service boundaries")).toMatchObject({
      harness: "claude-code",
      reason: "ability-match",
    });
  });

  it("routes shell automation to pi", () => {
    expect(taskRouter.routeTask("create shell script for nightly backups")).toMatchObject({
      harness: "pi",
      reason: "ability-match",
    });
  });

  it("routes generic debugging to a debugging-capable harness", () => {
    const result = taskRouter.routeTask("fix authentication bug in middleware");
    expect(["claude-code", "codex"]).toContain(result.harness);
    expect(result.reason).toBe("ability-match");
  });

  it("routes vague build goals to highest implement scorer", () => {
    expect(taskRouter.routeTask("build something new from scratch")).toMatchObject({
      harness: "pi",
      reason: "ability-match",
    });
  });
});

describe("ThinRouter ability matching", () => {
  it("falls back to typescript strength for codex", () => {
    expect(router.selectHarness("explain typescript generics in this module")).toBe("codex");
  });

  it("falls back to ide integration strength for cursor", () => {
    expect(router.selectHarness("improve ide integration for diagnostics")).toBe("cursor");
  });

  it("uses failover order to break ability ties", () => {
    const tiedRegistry: Registry = {
      harnesses: [
        {
          id: "pi",
          strengths: ["alpha"],
          weaknesses: [],
          binaries: ["pi"],
        },
        {
          id: "cursor",
          strengths: ["alpha"],
          weaknesses: [],
          binaries: ["cursor-agent"],
        },
      ],
    };
    const tiedPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "cursor", "codex", "claude-code"],
    };

    expect(selectHarness("do alpha work", tiedRegistry, tiedPolicy)).toBe("pi");
  });

  it("returns ability-match reason with score metadata", () => {
    const result = selectHarnessDetailed("improve api design for billing", registry, policy);

    expect(result.harness).toBe("codex");
    expect(result.reason).toBe("ability-match");
    expect(result.score).toBeGreaterThan(0);
  });

  it("exposes routeTask on ThinRouter", () => {
    const result = router.routeTask("write unit tests");
    expect(result.harness).toBe("codex");
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("ThinRouter failover", () => {
  it("uses the first failover harness when no abilities match", () => {
    expect(router.selectHarness("do something vague")).toBe("pi");
  });

  it("returns failover reason for unmatched tasks", () => {
    const result = selectHarnessDetailed("do something vague", registry, policy);

    expect(result).toEqual({
      harness: "pi",
      reason: "failover",
      score: 0,
      signals: [],
    });
  });

  it("respects a custom failover order", () => {
    const customPolicy: SessionPolicy = {
      routing: [],
      failover: ["cursor", "pi", "codex", "claude-code"],
    };

    expect(selectHarness("do something vague", registry, customPolicy)).toBe("cursor");
  });
});

describe("ThinRouter fixture integration", () => {
  it("loads fixture config from relay directory under project cwd", async () => {
    const { registry: loadedRegistry, sessionPolicy } = await loadRelayConfig(fixtureRoot);

    expect(loadedRegistry.harnesses.map((card) => card.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "pi",
    ]);
    expect(sessionPolicy.routing).toEqual([]);
    expect(sessionPolicy.failover).toEqual(["pi", "cursor", "claude-code", "codex"]);
  });

  it("routes fixture-backed tasks via ability scoring", async () => {
    const { registry: loadedRegistry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const fixtureRouter = new ThinRouter(loadedRegistry, sessionPolicy);

    const cases: Array<[string, HarnessId]> = [
      ["fix React component", "cursor"],
      ["write unit tests", "codex"],
      ["refactor module layout", "claude-code"],
      ["build cli tool", "pi"],
    ];

    for (const [task, harness] of cases) {
      expect(fixtureRouter.selectHarness(task)).toBe(harness);
    }
  });
});

describe("routeTask", () => {
  it("throws when failover is empty", () => {
    const emptyPolicy: SessionPolicy = { routing: [], failover: [] as HarnessId[] };
    expect(() => routeTask("anything", registry, emptyPolicy)).toThrow(
      "failover order must not be empty",
    );
  });
});
