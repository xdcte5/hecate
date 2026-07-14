import { describe, expect, it } from "vitest";
import { formatHarnessEventLine } from "./events.js";
import { diffChangedFiles, hasDeferredApproval } from "./outcome.js";

describe("hasDeferredApproval", () => {
  it("detects approval-gated agent output", () => {
    expect(
      hasDeferredApproval("All four changes are queued and waiting on your approval"),
    ).toBe(true);
    expect(hasDeferredApproval("nothing has been written yet")).toBe(true);
    expect(hasDeferredApproval("wrote 3 files successfully")).toBe(false);
  });
});

describe("diffChangedFiles", () => {
  it("returns files present after but not before", () => {
    const before = " M old.ts\n?? new.ts";
    const after = " M old.ts\n M changed.ts\n?? new.ts";
    expect(diffChangedFiles(before, after)).toEqual(["changed.ts"]);
  });
});

describe("formatHarnessEventLine", () => {
  it("formats step and tool events", () => {
    expect(
      formatHarnessEventLine({
        type: "step_start",
        at: new Date().toISOString(),
        stepId: "implement",
        harness: "pi",
        task: "build",
        stepIndex: 0,
        totalSteps: 2,
      }),
    ).toBe("▶ Step 1/2: pi running…");
    expect(
      formatHarnessEventLine({
        type: "tool_start",
        at: new Date().toISOString(),
        toolName: "read",
      }),
    ).toBe("tool ▶ read");
  });
});
