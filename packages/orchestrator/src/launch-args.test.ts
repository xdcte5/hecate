import { describe, expect, it } from "vitest";
import { buildLaunchArgs, formatModelLabel } from "./launch-args.js";

describe("buildLaunchArgs", () => {
  it("runs Claude Code with auto-approve for relay auto-run", () => {
    expect(buildLaunchArgs("claude-code", "do task")).toEqual([
      "-p",
      "--dangerously-skip-permissions",
      "do task",
    ]);
  });

  it("passes model to Claude Code", () => {
    expect(buildLaunchArgs("claude-code", "do task", "claude-sonnet-4-6")).toEqual([
      "-p",
      "--dangerously-skip-permissions",
      "--model",
      "claude-sonnet-4-6",
      "do task",
    ]);
  });

  it("runs Codex in full-auto mode", () => {
    expect(buildLaunchArgs("codex", "do task")).toEqual(["exec", "--full-auto", "do task"]);
  });

  it("passes model to Codex", () => {
    expect(buildLaunchArgs("codex", "do task", "o4-mini")).toEqual([
      "exec",
      "--full-auto",
      "-m",
      "o4-mini",
      "do task",
    ]);
  });

  it("passes model to Cursor", () => {
    expect(buildLaunchArgs("cursor", "do task", "composer-2")).toEqual([
      "-p",
      "--model",
      "composer-2",
      "do task",
    ]);
  });
});

describe("formatModelLabel", () => {
  it("shortens claude model ids", () => {
    expect(formatModelLabel("claude-sonnet-4-6")).toBe("sonnet");
    expect(formatModelLabel("o4-mini")).toBe("o4-mini");
  });
});
