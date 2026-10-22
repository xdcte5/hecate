import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@relay/session";
import {
  buildTraceAudit,
  formatTraceHuman,
  formatTraceJson,
  isFailoverHop,
} from "./trace-format.js";

function sampleEvents(): SessionEvent[] {
  return [
    {
      at: "2026-07-16T10:00:00.000Z",
      event: "session_started",
      goal: "fix login",
      harness: "cursor",
    },
    {
      at: "2026-07-16T10:01:00.000Z",
      event: "handoff_prepared",
      from: "cursor",
      to: "pi",
      handoffSeq: 1,
    },
    {
      at: "2026-07-16T10:01:05.000Z",
      event: "harness_complete",
      stepId: "implement",
      harness: "claude-code",
      modelTier: "capable",
      ok: true,
      summary: "created login form",
      costUsd: 0.0123,
      inputTokens: 900,
      outputTokens: 120,
    },
    {
      at: "2026-07-16T10:01:06.000Z",
      event: "graph_node",
      stepId: "implement",
      nodeId: "verifier-0",
      nodeType: "artifact",
      ok: true,
      durationMs: 23,
      evidence: "hello.sh exists",
    },
    {
      at: "2026-07-16T10:01:07.000Z",
      event: "verify_outcome",
      stepId: "implement",
      harness: "claude-code",
      ok: true,
      recommendation: "ACT",
      confidence: 0.95,
      evidence: "hello.sh exists",
      verifierId: "graph",
      durationMs: 25,
    },
    {
      at: "2026-07-16T10:01:08.000Z",
      event: "routing_outcome",
      stepId: "implement",
      harness: "claude-code",
      modelTier: "capable",
      taskType: "implement",
      ok: true,
      verifyOk: true,
      failoverUsed: true,
      failoverReason: "auth",
      costUsd: 0.0123,
      reason: "blend:auto",
    },
    {
      at: "2026-07-16T10:02:00.000Z",
      event: "decision_recorded",
      harness: "claude-code",
      text: "Use existing auth middleware",
    },
  ];
}

describe("buildTraceAudit", () => {
  it("groups handoff_prepared with harness_complete and routing_outcome", () => {
    const audit = buildTraceAudit("sess-1", sampleEvents());

    expect(audit.hopCount).toBe(2);
    expect(audit.hops[0]?.kind).toBe("start");
    expect(audit.hops[1]?.kind).toBe("handoff");
    expect(audit.hops[1]?.events.map((e) => e.event)).toEqual([
      "handoff_prepared",
      "harness_complete",
      "graph_node",
      "verify_outcome",
      "routing_outcome",
    ]);
    expect(audit.hops[1]).toMatchObject({
      from: "cursor",
      to: "pi",
      harness: "claude-code",
      modelTier: "capable",
      costUsd: 0.0123,
      failoverReason: "auth",
      failoverUsed: true,
    });
    expect(audit.otherEvents).toHaveLength(1);
    expect(audit.otherEvents[0]?.event).toBe("decision_recorded");
  });

  it("flags auth, capability, and verify failovers", () => {
    for (const reason of ["auth", "capability", "verify"] as const) {
      const hop = buildTraceAudit("sess-1", [
        {
          at: "2026-07-16T10:00:00.000Z",
          event: "routing_outcome",
          harness: "codex",
          failoverReason: reason,
        },
      ]).hops[0]!;

      expect(isFailoverHop(hop)).toBe(true);
    }

    const noneHop = buildTraceAudit("sess-1", [
      {
        at: "2026-07-16T10:00:00.000Z",
        event: "routing_outcome",
        harness: "codex",
        failoverReason: "none",
      },
    ]).hops[0]!;
    expect(isFailoverHop(noneHop)).toBe(false);
  });
});

describe("formatTraceHuman", () => {
  it("highlights failover hops and routing fields", () => {
    const output = formatTraceHuman(buildTraceAudit("sess-1", sampleEvents()));

    expect(output).toContain("Session: sess-1");
    expect(output).toContain("Hops: 2");
    expect(output).toContain("⚠ FAILOVER (auth)");
    expect(output).toContain("harness=claude-code");
    expect(output).toContain("modelTier=capable");
    expect(output).toContain("costUsd=$0.0123");
    expect(output).toContain("failoverReason=auth");
    expect(output).toContain("Other events:");
    expect(output).toContain("decision_recorded");
  });
});

describe("formatTraceJson", () => {
  it("exports machine-readable grouped hops", () => {
    const parsed = JSON.parse(formatTraceJson(buildTraceAudit("sess-1", sampleEvents())));

    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.hops[1].failover).toBe(true);
    expect(parsed.hops[1].costUsd).toBe(0.0123);
    expect(parsed.hops[1].events.map((event: { event: string }) => event.event)).toContain("graph_node");
    expect(parsed.hops[1].events.map((event: { event: string }) => event.event)).toContain("verify_outcome");
    expect(parsed.hops[1].label).toContain("Handoff");
  });
});
