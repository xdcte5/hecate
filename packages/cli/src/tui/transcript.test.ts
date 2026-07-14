import { describe, expect, it } from "vitest";
import {
  classifyHarnessEvent,
  createTranscriptContext,
  formatHarnessEvent,
  formatTranscriptEntry,
  harnessEventToLines,
  parseHarnessEvent,
  parseOrchestratorLine,
  renderHarnessEvent,
  toggleTranscriptToolExpand,
} from "./transcript.js";

const at = "2026-07-14T09:00:00.000Z";

describe("transcript", () => {
  it("classifies plan lines", () => {
    expect(parseOrchestratorLine("Plan (2 steps, 1 wave(s)):").kind).toBe("plan");
    expect(parseOrchestratorLine("  Wave 0:").kind).toBe("plan");
    expect(parseOrchestratorLine("    • Pi (ability-match) — build login").kind).toBe("plan");
  });

  it("classifies tool and agent lines", () => {
    expect(parseOrchestratorLine("tool ▶ read").kind).toBe("tool");
    expect(parseOrchestratorLine("▶ Step 1/2: Pi running…").kind).toBe("agent");
    expect(parseOrchestratorLine("  ✗ Pi failed").kind).toBe("error");
    expect(parseOrchestratorLine("  ✓ Pi finished.").kind).toBe("success");
  });

  it("formats entries with relay-branded prefixes", () => {
    const entry = parseOrchestratorLine("tool ▶ bash");
    const rendered = formatTranscriptEntry(entry);
    expect(rendered).toContain("tool");
    expect(rendered).toContain("bash");
  });

  it("formats typed harness events (Sprint 2 adapter)", () => {
    expect(formatHarnessEvent({ type: "tool_start", at, toolName: "read" })).toBe(
      "tool ▶ read",
    );
    expect(
      formatHarnessEvent({
        type: "plan",
        at,
        steps: [
          { id: "implement", task: "build", harness: "pi", wave: 0 },
          { id: "test", task: "test", harness: "codex", wave: 1 },
        ],
      }),
    ).toBe("Plan (2 steps, 2 wave(s))");
    expect(formatHarnessEvent({ type: "error", at, message: "wave skipped" })).toBe(
      "error: wave skipped",
    );
    expect(formatHarnessEvent({ type: "handoff", at, from: "pi", to: "codex" })).toBe(
      "handoff: pi → codex",
    );
    expect(formatHarnessEvent({ type: "retry_start", at, reason: "rate limit" })).toBe(
      "retrying… (rate limit)",
    );
  });

  it("parses typed harness events via components", () => {
    const entry = parseHarnessEvent({
      type: "tool_start",
      at,
      toolName: "read",
      args: { path: "src/main.ts" },
    });
    expect(entry?.kind).toBe("tool");
    expect(entry?.text).toContain("read  src/main.ts");
    expect(entry?.text).toContain("▶");

    const done = parseHarnessEvent({
      type: "step_end",
      at,
      stepId: "implement",
      harness: "pi",
      ok: true,
      summary: "Pi finished.",
    });
    expect(done?.kind).toBe("success");
    expect(done?.text).toContain("Pi finished.");

    expect(classifyHarnessEvent({ type: "plan", at, steps: [] })).toBe("plan");
  });

  it("routes plan and error events to message components", () => {
    const plan = renderHarnessEvent({
      type: "plan",
      at,
      steps: [
        { id: "s1", task: "scaffold login", harness: "pi", wave: 0 },
        { id: "s2", task: "add tests", harness: "codex", wave: 1 },
      ],
    });
    expect(plan.lines.some((line) => line.includes("Plan (2 steps"))).toBe(true);
    expect(plan.lines.some((line) => line.includes("Wave 0"))).toBe(true);

    const err = harnessEventToLines({
      type: "error",
      at,
      message: "build failed",
      code: "verify",
    });
    expect(err[0]).toContain("build failed");
    expect(err[0]).toContain("verify");
  });

  it("toggles tool block expand state in context", () => {
    let ctx = createTranscriptContext();
    ctx = renderHarnessEvent(
      { type: "tool_start", at, toolName: "read", toolCallId: "c1", args: { path: "a.ts" } },
      ctx,
    ).context;
    ctx = renderHarnessEvent(
      {
        type: "tool_end",
        at,
        toolName: "read",
        toolCallId: "c1",
        ok: true,
        output: "hello\nworld",
      },
      ctx,
    ).context;

    expect(ctx.expandedTools.has("c1")).toBe(false);
    ctx = toggleTranscriptToolExpand(ctx, "c1");
    expect(ctx.expandedTools.has("c1")).toBe(true);
    expect(ctx.toolBlocks.get("c1")?.expanded).toBe(true);
  });
});
