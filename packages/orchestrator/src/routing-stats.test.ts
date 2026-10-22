import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoutingOutcome } from "@relay/schema";
import { readEvents } from "@relay/session";
import {
  ROUTING_STATS_PATH,
  buildOutcomeFromStep,
  computeHarnessSuccessRates,
  loadRoutingOutcomes,
  pickHarnessFromLocalRates,
  recordRoutingAuditEvents,
  recordRoutingOutcome,
  resolveRoutingStatsPath,
} from "./routing-stats.js";
import type { RunStep } from "./types.js";

const baseStep: RunStep = {
  id: "implement",
  task: "build login page",
  harness: "pi",
  reason: "ability-match",
  wave: 0,
  status: "done",
  model: "openai-codex/gpt-5.4",
  routeReason: "blend:auto",
};

describe("routing-stats", () => {
  it("records and loads routing outcomes from jsonl", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-routing-"));
    try {
      const outcome: RoutingOutcome = {
        ts: "2026-07-14T10:30:00.000Z",
        sessionId: "sess_1",
        stepId: "implement",
        taskType: "implement",
        task: "build login page",
        harness: "pi",
        ok: true,
        verifyOk: true,
        filesChanged: 2,
        durationMs: 1200,
      };

      await recordRoutingOutcome(cwd, outcome);

      const path = resolveRoutingStatsPath(cwd);
      expect(path.endsWith(ROUTING_STATS_PATH)).toBe(true);

      const raw = await readFile(path, "utf8");
      expect(JSON.parse(raw.trim())).toEqual(outcome);

      const loaded = await loadRoutingOutcomes(cwd);
      expect(loaded).toEqual([outcome]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("buildOutcomeFromStep maps step metadata into a routing outcome", () => {
    const outcome = buildOutcomeFromStep(
      baseStep,
      "sess_abc",
      { ok: true, harness: "pi", summary: "done", filesTouched: ["a.ts", "b.ts"] },
      { verifyOk: true, durationMs: 5000, failoverUsed: false },
    );

    expect(outcome).toMatchObject({
      sessionId: "sess_abc",
      stepId: "implement",
      taskType: "implement",
      harness: "pi",
      ok: true,
      verifyOk: true,
      filesChanged: 2,
      durationMs: 5000,
      failoverUsed: false,
      reason: "blend:auto",
    });
    expect(outcome.ts).toBeTruthy();
  });

  it("records failoverReason when auth preflight skips a harness", () => {
    const outcome = buildOutcomeFromStep(
      baseStep,
      "sess_abc",
      { ok: true, harness: "claude-code", summary: "done" },
      { durationMs: 3000, failoverUsed: true, failoverReason: "auth" },
    );

    expect(outcome.failoverReason).toBe("auth");
    expect(outcome.failoverUsed).toBe(true);
  });

  it("includes usage fields when provided in options", () => {
    const outcome = buildOutcomeFromStep(
      baseStep,
      "sess_1",
      { ok: true, harness: "pi", summary: "done" },
      {
        durationMs: 12_000,
        verifyOk: true,
        inputTokens: 999,
        outputTokens: 88,
        costUsd: 0.05,
      },
    );

    expect(outcome).toMatchObject({
      inputTokens: 999,
      outputTokens: 88,
      costUsd: 0.05,
    });
  });

  it("records harness_complete and routing_outcome in events.jsonl", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-audit-"));
    try {
      const step: RunStep = {
        ...baseStep,
        modelTier: "capable",
      };

      await recordRoutingAuditEvents(
        cwd,
        "sess_audit",
        step,
        { ok: true, harness: "pi", summary: "done" },
        {
          verifyOk: true,
          failoverUsed: true,
          failoverReason: "auth",
          costUsd: 0.05,
          inputTokens: 10,
          outputTokens: 5,
        },
      );

      const events = await readEvents(cwd, "sess_audit");
      expect(events.map((e) => e.event)).toEqual(["harness_complete", "routing_outcome"]);
      expect(events[0]).toMatchObject({
        event: "harness_complete",
        stepId: "implement",
        harness: "pi",
        modelTier: "capable",
        costUsd: 0.05,
        ok: true,
      });
      expect(events[1]).toMatchObject({
        event: "routing_outcome",
        failoverReason: "auth",
        failoverUsed: true,
        costUsd: 0.05,
        reason: "blend:auto",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("computes harness success rates and picks the best failover candidate", () => {
    const outcomes: RoutingOutcome[] = [
      { ts: "1", sessionId: "s", stepId: "implement", taskType: "implement", task: "a", harness: "pi", ok: true, verifyOk: true },
      { ts: "2", sessionId: "s", stepId: "implement", taskType: "implement", task: "b", harness: "pi", ok: true, verifyOk: true },
      { ts: "3", sessionId: "s", stepId: "implement", taskType: "implement", task: "c", harness: "pi", ok: true, verifyOk: true },
      { ts: "4", sessionId: "s", stepId: "implement", taskType: "implement", task: "d", harness: "cursor", ok: false },
      { ts: "5", sessionId: "s", stepId: "implement", taskType: "implement", task: "e", harness: "cursor", ok: true, verifyOk: true },
      { ts: "6", sessionId: "s", stepId: "implement", taskType: "implement", task: "f", harness: "cursor", ok: false },
    ];

    const rates = computeHarnessSuccessRates(outcomes, "implement");
    expect(rates[0]).toMatchObject({ harness: "pi", rate: 1, samples: 3 });
    expect(rates[1]).toMatchObject({ harness: "cursor", rate: 1 / 3, samples: 3 });

    expect(pickHarnessFromLocalRates(rates, ["cursor", "pi", "codex"])).toBe("pi");
  });
});
