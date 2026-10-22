import { describe, expect, it } from "vitest";
import {
  RoutingConfigSchema,
  SessionPolicyGovernanceSchema,
  SessionPolicySchema,
  resolveSessionPolicyGovernance,
  resolveSessionPolicyRoutingConfig,
  resolveSessionPolicyStepRouting,
} from "./session-policy.js";

describe("SessionPolicyGovernanceSchema", () => {
  it("applies sensible defaults when governance is omitted", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["cursor"],
    });

    expect(policy.governance).toBeUndefined();
    expect(resolveSessionPolicyGovernance(policy)).toEqual({
      requireGitSnapshotOnHandoff: true,
      maxHandoffTokens: 8000,
      maxTranscriptLines: 200,
    });
  });

  it("parses explicit governance values from yaml-shaped input", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["cursor"],
      governance: {
        requireGitSnapshotOnHandoff: false,
        maxHandoffTokens: 4000,
        maxTranscriptLines: 100,
      },
    });

    expect(resolveSessionPolicyGovernance(policy)).toEqual({
      requireGitSnapshotOnHandoff: false,
      maxHandoffTokens: 4000,
      maxTranscriptLines: 100,
    });
  });

  it("fills partial governance fields with defaults", () => {
    const governance = SessionPolicyGovernanceSchema.parse({
      maxTranscriptLines: 50,
    });

    expect(governance).toEqual({
      requireGitSnapshotOnHandoff: true,
      maxHandoffTokens: 8000,
      maxTranscriptLines: 50,
    });
  });
});

describe("SessionPolicyVerificationSchema", () => {
  it("defaults verification gate to enabled", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["pi"],
      verification: {},
    });

    expect(policy.verification).toEqual({ enableTestGate: true, maxStepRetries: 3 });
  });
});

describe("RoutingConfigSchema", () => {
  it("applies blended routing defaults when routing_config is omitted", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["pi", "cursor", "claude-code", "codex"],
    });

    expect(policy.routing_config).toBeUndefined();
    expect(resolveSessionPolicyRoutingConfig(policy)).toEqual({
      mode: "auto",
      min_local_samples: 5,
      min_success_rate: 0.3,
      blend: { local: 0.425, benchmark: 0.2125, heuristic: 0.2125, cost: 0.15 },
    });
  });

  it("parses explicit routing_config from yaml-shaped input", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["pi", "cursor", "claude-code", "codex"],
      routing_config: {
        mode: "heuristic",
        min_local_samples: 10,
        blend: { local: 0.6, benchmark: 0.2, heuristic: 0.2 },
      },
    });

    expect(resolveSessionPolicyRoutingConfig(policy)).toEqual({
      mode: "heuristic",
      min_local_samples: 10,
      min_success_rate: 0.3,
      blend: { local: 0.6, benchmark: 0.2, heuristic: 0.2, cost: 0.15 },
    });
  });

  it("fills partial routing_config fields with defaults", () => {
    const config = RoutingConfigSchema.parse({ mode: "benchmark" });

    expect(config).toEqual({
      mode: "benchmark",
      min_local_samples: 5,
      min_success_rate: 0.3,
      blend: { local: 0.425, benchmark: 0.2125, heuristic: 0.2125, cost: 0.15 },
    });
  });

  it("parses min_success_rate from routing_config", () => {
    const config = RoutingConfigSchema.parse({ min_success_rate: 0.5 });

    expect(config.min_success_rate).toBe(0.5);
  });

  it("keeps routing[] overrides separate from routing_config", () => {
    const policy = SessionPolicySchema.parse({
      routing: [{ pattern: "(?i)react", harness: "cursor" }],
      failover: ["pi", "cursor", "claude-code", "codex"],
      routing_config: { mode: "auto" },
    });

    expect(policy.routing).toHaveLength(1);
    expect(policy.routing[0]?.harness).toBe("cursor");
    expect(resolveSessionPolicyRoutingConfig(policy).mode).toBe("auto");
  });
});

describe("StepRoutingSchema", () => {
  it("parses step_routing prefer lists from yaml-shaped input", () => {
    const policy = SessionPolicySchema.parse({
      routing: [],
      failover: ["claude-code", "codex", "pi"],
      step_routing: {
        implement: { prefer: ["claude-code", "codex", "pi"] },
        test: { prefer: ["codex", "claude-code"] },
        review: { prefer: ["claude-code"], model_tier: "capable" },
      },
    });

    expect(resolveSessionPolicyStepRouting(policy)).toEqual({
      implement: { prefer: ["claude-code", "codex", "pi"] },
      test: { prefer: ["codex", "claude-code"] },
      review: { prefer: ["claude-code"], model_tier: "capable" },
    });
  });
});
