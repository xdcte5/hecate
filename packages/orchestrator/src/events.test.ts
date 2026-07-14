import { describe, expect, it, vi } from "vitest";
import {
  HarnessEventEmitter,
  emitOrchestratorEvent,
  formatHarnessEventLine,
  makeErrorEvent,
  makePlanEvent,
  makeStepEndEvent,
  makeStepStartEvent,
  mapPiEventToHarnessEvent,
} from "./events.js";

const at = "2026-07-14T09:00:00.000Z";

describe("HarnessEventEmitter", () => {
  it("notifies subscribers and supports unsubscribe", () => {
    const emitter = new HarnessEventEmitter();
    const handler = vi.fn();
    const off = emitter.on(handler);

    const event = makeStepStartEvent(
      { id: "implement", harness: "pi", task: "build", wave: 0 },
      0,
      1,
    );
    emitter.emit(event);
    expect(handler).toHaveBeenCalledWith(event);

    off();
    emitter.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("emitOrchestratorEvent", () => {
  it("forwards typed events without duplicate onLine when onEvent is set", () => {
    const onEvent = vi.fn();
    const onLine = vi.fn();
    const event = makeStepStartEvent(
      { id: "implement", harness: "pi", task: "build", wave: 0 },
      0,
      2,
    );

    emitOrchestratorEvent(event, { onEvent, onLine });
    expect(onEvent).toHaveBeenCalledWith(event);
    expect(onLine).not.toHaveBeenCalled();
  });

  it("forwards derived lines when only onLine is set", () => {
    const onLine = vi.fn();
    const event = makeStepStartEvent(
      { id: "implement", harness: "pi", task: "build", wave: 0 },
      0,
      2,
    );

    emitOrchestratorEvent(event, { onLine });
    expect(onLine).toHaveBeenCalledWith("▶ Step 1/2: pi running…");
  });

  it("skips onLine when formatHarnessEventLine returns null", () => {
    const onLine = vi.fn();
    emitOrchestratorEvent(
      {
        type: "agent_message",
        at,
        role: "assistant",
        text: "hello",
        delta: true,
      },
      { onLine },
    );
    expect(onLine).not.toHaveBeenCalled();
  });
});

describe("formatHarnessEventLine", () => {
  it("formats plan and error events", () => {
    expect(
      formatHarnessEventLine(
        makePlanEvent([
          { id: "implement", task: "build", harness: "pi", wave: 0 },
          { id: "test", task: "test", harness: "codex", wave: 1 },
        ]),
      ),
    ).toBe("Plan (2 steps, 2 wave(s))");

    expect(formatHarnessEventLine(makeErrorEvent("wave skipped", "wave_skipped"))).toBe(
      "error: wave skipped",
    );
    expect(
      formatHarnessEventLine(makeStepEndEvent({ id: "implement", harness: "pi" }, true, "done")),
    ).toBe("  ✓ done");
  });
});

describe("mapPiEventToHarnessEvent", () => {
  it("maps tool lifecycle events", () => {
    const start = mapPiEventToHarnessEvent(
      { type: "tool_execution_start", toolName: "read", toolCallId: "tc_1" },
      "pi",
    );
    expect(start).toMatchObject({ type: "tool_start", toolName: "read" });

    const end = mapPiEventToHarnessEvent(
      { type: "tool_execution_end", toolName: "read", isError: false },
      "pi",
    );
    expect(end).toMatchObject({ type: "tool_end", toolName: "read", ok: true });
  });
});
