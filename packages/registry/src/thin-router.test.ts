import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { loadRelayConfig } from "./load-registry.js";
import { ThinRouter, selectHarness, selectHarnessDetailed } from "./thin-router.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: ["architecture", "refactoring", "complex reasoning", "system design"],
      weaknesses: ["quick edits", "unit tests"],
      binaries: ["claude"],
    },
    {
      id: "codex",
      strengths: ["unit tests", "test generation", "api design", "typescript"],
      weaknesses: ["ui work", "frontend styling"],
      binaries: ["codex"],
    },
    {
      id: "cursor",
      strengths: ["react", "frontend", "component fixes", "ide integration", "jsx", "tsx"],
      weaknesses: ["long-running tasks", "deep architecture"],
      binaries: ["cursor-agent"],
    },
    {
      id: "pi",
      strengths: ["scripts", "automation", "cli", "lightweight tasks"],
      weaknesses: ["complex codebases", "multi-file refactors"],
      binaries: ["pi"],
    },
  ],
};

const policy: SessionPolicy = {
  routing: [
    {
      pattern: "(?i)(unit test|write tests|vitest|jest|mocha)",
      harness: "codex",
      description: "Test writing tasks go to Codex",
    },
    {
      pattern: "(?i)(react|component|jsx|tsx|frontend)",
      harness: "cursor",
      description: "Frontend and React work goes to Cursor",
    },
    {
      pattern: "(?i)(refactor|architecture|system design)",
      harness: "claude-code",
      description: "Architecture and refactoring goes to Claude Code",
    },
    {
      pattern: "(?i)\\b(script|automation|cli|shell)\\b",
      harness: "pi",
      description: "Scripts and automation go to Pi",
    },
  ],
  failover: ["cursor", "claude-code", "codex", "pi"],
};

const router = new ThinRouter(registry, policy);

describe("ThinRouter routing rules", () => {
  it("routes write unit tests to codex", () => {
    expect(router.selectHarness("write unit tests for auth module")).toBe("codex");
  });

  it("routes fix React component to cursor", () => {
    expect(router.selectHarness("fix React component rendering bug")).toBe("cursor");
  });

  it("routes vitest tasks to codex", () => {
    expect(router.selectHarness("add vitest coverage for parser")).toBe("codex");
  });

  it("routes jsx work to cursor", () => {
    expect(router.selectHarness("update jsx markup in header")).toBe("cursor");
  });

  it("routes refactor tasks to claude-code", () => {
    expect(router.selectHarness("refactor payment service boundaries")).toBe("claude-code");
  });

  it("routes shell automation to pi", () => {
    expect(router.selectHarness("create shell script for nightly backups")).toBe("pi");
  });

  it("matches routing rules case-insensitively", () => {
    expect(router.selectHarness("FIX REACT COMPONENT in dashboard")).toBe("cursor");
    expect(router.selectHarness("WRITE UNIT TESTS for reducer")).toBe("codex");
  });

  it("prefers the first matching routing rule when several apply", () => {
    expect(router.selectHarness("write unit tests for React component")).toBe("codex");
  });

  it("returns routing-rule reason with matched pattern metadata", () => {
    const result = selectHarnessDetailed("fix React component", registry, policy);

    expect(result).toEqual({
      harness: "cursor",
      reason: "routing-rule",
      matchedPattern: "(?i)(react|component|jsx|tsx|frontend)",
    });
  });
});

describe("ThinRouter strength matching", () => {
  it("falls back to typescript strength for codex", () => {
    expect(router.selectHarness("explain typescript generics in this module")).toBe("codex");
  });

  it("falls back to ide integration strength for cursor", () => {
    expect(router.selectHarness("improve ide integration for diagnostics")).toBe("cursor");
  });

  it("falls back to lightweight tasks strength for pi", () => {
    expect(router.selectHarness("handle this lightweight tasks queue")).toBe("pi");
  });

  it("uses failover order to break strength ties", () => {
    const tiedPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "cursor", "codex", "claude-code"],
    };

    expect(
      selectHarness("work on frontend and scripts", registry, tiedPolicy),
    ).toBe("pi");
  });

  it("returns strength-match reason with score metadata", () => {
    const result = selectHarnessDetailed(
      "improve api design for billing",
      registry,
      policy,
    );

    expect(result.harness).toBe("codex");
    expect(result.reason).toBe("strength-match");
    expect(result.strengthScore).toBe(1);
  });
});

describe("ThinRouter failover", () => {
  it("uses the first failover harness when no rules or strengths match", () => {
    expect(router.selectHarness("do something vague")).toBe("cursor");
  });

  it("returns failover reason for unmatched tasks", () => {
    const result = selectHarnessDetailed("do something vague", registry, policy);

    expect(result).toEqual({
      harness: "cursor",
      reason: "failover",
    });
  });

  it("respects a custom failover order", () => {
    const customPolicy: SessionPolicy = {
      routing: [],
      failover: ["pi", "codex", "cursor", "claude-code"],
    };

    expect(selectHarness("do something vague", registry, customPolicy)).toBe("pi");
  });
});

describe("ThinRouter resilience", () => {
  it("skips invalid regex patterns and continues matching", () => {
    const brokenPolicy: SessionPolicy = {
      routing: [
        { pattern: "[invalid", harness: "pi" },
        { pattern: "(?i)react", harness: "cursor" },
      ],
      failover: policy.failover,
    };

    expect(selectHarness("fix react state", registry, brokenPolicy)).toBe("cursor");
  });

  it("loads fixture config from relay directory under project cwd", async () => {
    const { registry: loadedRegistry, sessionPolicy } = await loadRelayConfig(fixtureRoot);

    expect(loadedRegistry.harnesses.map((card) => card.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "pi",
    ]);
    expect(sessionPolicy.failover).toEqual(["cursor", "claude-code", "codex", "pi"]);
  });

  it("routes fixture-backed tasks the same as in-memory config", async () => {
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
