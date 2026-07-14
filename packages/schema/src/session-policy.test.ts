import { describe, expect, it } from "vitest";
import {
  SessionPolicyGovernanceSchema,
  SessionPolicySchema,
  resolveSessionPolicyGovernance,
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

    expect(policy.verification).toEqual({ enableTestGate: true });
  });
});
