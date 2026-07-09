import { join } from "node:path";
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
  it("routes fix React component to cursor via frontend+debug abilities", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.routeTask("fix React component");

    expect(result.harness).toBe("cursor");
    expect(result.reason).toBe("ability-match");
    expect(result.signals).toContain("frontend");
  });

  it("routes write unit tests to codex via ability match", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.routeTask("write unit tests");

    expect(result.harness).toBe("codex");
    expect(result.reason).toBe("ability-match");
    expect(result.signals).toContain("test");
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

  it("falls back to pi for unmatched goals", async () => {
    const { registry, sessionPolicy } = await loadRelayConfig(fixtureRoot);
    const router = new ThinRouter(registry, sessionPolicy);
    const result = router.routeTask("do something vague");

    expect(result.harness).toBe("pi");
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
