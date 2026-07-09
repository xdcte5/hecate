import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarnessId } from "@relay/schema";
import { resolveSessionPolicyGovernance } from "@relay/schema";
import { loadRelayConfig } from "./load-registry.js";
import { ThinRouter } from "./thin-router.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

describe("handoff --to auto (fixture integration)", () => {
  it("routes fix React component to cursor via routing-rule", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.selectHarnessDetailed("fix React component");

    expect(result.harness).toBe("cursor");
    expect(result.reason).toBe("routing-rule");
    expect(result.matchedPattern).toContain("react");
  });

  it("routes write unit tests to codex via routing-rule", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.selectHarnessDetailed("write unit tests");

    expect(result.harness).toBe("codex");
    expect(result.reason).toBe("routing-rule");
    expect(result.matchedPattern).toContain("unit test");
  });

  it("routes refactor module layout to claude-code", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);

    expect(router.selectHarness("refactor module layout")).toBe("claude-code");
  });

  it("routes build cli tool to pi", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);

    expect(router.selectHarness("build cli tool")).toBe("pi");
  });

  it("falls back to cursor for unmatched goals", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.selectHarnessDetailed("do something vague");

    expect(result.harness).toBe("cursor");
    expect(result.reason).toBe("failover");
  });

  it("loads governance defaults from fixture session-policy", async () => {
    const { sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const governance = resolveSessionPolicyGovernance(sessionPolicy);

    expect(governance).toEqual({
      requireGitSnapshotOnHandoff: true,
      maxHandoffTokens: 8000,
      maxTranscriptLines: 200,
    });
  });

  it("matches expected harnesses for fixture-backed tasks", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);

    const cases: Array<[string, HarnessId]> = [
      ["fix React component", "cursor"],
      ["write unit tests", "codex"],
      ["refactor module layout", "claude-code"],
      ["build cli tool", "pi"],
    ];

    for (const [task, expected] of cases) {
      expect(router.selectHarness(task)).toBe(expected);
    }
  });
});
