import { describe, expect, it } from "vitest";
import { parseGenericToolLine } from "./streaming-cli.js";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";

describe("parseGenericToolLine", () => {
  it("parses read/write/bash action lines", () => {
    expect(parseGenericToolLine("Reading src/app/page.tsx")).toEqual({
      toolName: "read",
      args: { path: "src/app/page.tsx" },
    });
    expect(parseGenericToolLine("Writing src/foo.ts")).toEqual({
      toolName: "write",
      args: { path: "src/foo.ts" },
    });
    expect(parseGenericToolLine("Running pnpm test")).toEqual({
      toolName: "bash",
      args: { command: "pnpm test" },
    });
  });
});

describe("StreamingCliDriver harness parsers", () => {
  it("ClaudeDriver recognizes ToolUse lines", () => {
    const driver = new ClaudeDriver();
    expect(driver.parseToolLine("ToolUse: Read src/auth.ts")).toEqual({
      toolName: "read",
      args: { detail: "src/auth.ts" },
    });
  });

  it("CodexDriver recognizes exec lines", () => {
    const driver = new CodexDriver();
    expect(driver.parseToolLine("exec: pnpm vitest run")).toEqual({
      toolName: "bash",
      args: { command: "pnpm vitest run" },
    });
  });
});

describe("HarnessDriver interface", () => {
  it("exposes cancel and streamEvents on ClaudeDriver", () => {
    const driver = new ClaudeDriver();
    expect(typeof driver.cancel).toBe("function");
    expect(typeof driver.streamEvents).toBe("function");
    const events: string[] = [];
    const off = driver.streamEvents((event) => events.push(event.type));
    off();
    expect(events).toEqual([]);
  });
});
