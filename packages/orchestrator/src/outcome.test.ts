import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatHarnessEventLine } from "./events.js";
import {
  diffChangedFiles,
  hasDeferredApproval,
  snapshotWorkingTree,
  verifyWriteOutcome,
} from "./outcome.js";

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

describe("verifyWriteOutcome", () => {
  it("detects files created in a non-git project", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-outcome-non-git-"));
    const before = await snapshotWorkingTree(cwd);

    await writeFile(join(cwd, "created-by-agent.txt"), "hello", "utf8");

    const result = await verifyWriteOutcome(cwd, "done", before);

    expect(result.ok).toBe(true);
    expect(result.filesTouched).toEqual(["created-by-agent.txt"]);
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
