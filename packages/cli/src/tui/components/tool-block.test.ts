import { describe, expect, it } from "vitest";
import {
  completeToolBlockState,
  createToolBlockState,
  formatToolEndLine,
  formatToolStartLine,
  summarizeToolArgs,
  toggleToolBlockExpanded,
  toolStatusIcon,
  TOOL_EXPAND_KEYBIND,
} from "./tool-block.js";

describe("tool-block", () => {
  it("summarizes read tool args with path", () => {
    expect(summarizeToolArgs("read", { path: "src/app/page.tsx" })).toBe(
      "read  src/app/page.tsx",
    );
  });

  it("summarizes bash tool args with command", () => {
    expect(summarizeToolArgs("bash", { command: "pnpm exec tsc --noEmit" })).toBe(
      "bash  pnpm exec tsc --noEmit",
    );
  });

  it("formats running tool start with expand hint", () => {
    const line = formatToolStartLine("read", { path: "src/foo.ts" });
    expect(line).toContain("tool");
    expect(line).toContain("▶");
    expect(line).toContain("read  src/foo.ts");
    expect(line).toContain(TOOL_EXPAND_KEYBIND);
  });

  it("formats collapsed tool end with line count", () => {
    const lines = formatToolEndLine("read", true, "line1\nline2\nline3");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("✓");
    expect(lines[0]).toContain("(3 lines)");
  });

  it("formats expanded tool end with body lines", () => {
    const lines = formatToolEndLine("write", true, "export const x = 1;", { expanded: true });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("▼");
    expect(lines[1]).toContain("│");
    expect(lines[1]).toContain("export const x = 1;");
  });

  it("formats failed tool end with error icon", () => {
    const lines = formatToolEndLine("bash", false, "command not found");
    expect(lines[0]).toContain("✗");
    expect(lines[0]).toContain("command not found");
  });

  it("uses status icons for running, done, and expanded states", () => {
    expect(toolStatusIcon("running")).toBe("▶");
    expect(toolStatusIcon("done")).toBe("✓");
    expect(toolStatusIcon("done", true)).toBe("▼");
    expect(toolStatusIcon("error")).toBe("✗");
  });

  it("tracks tool block state across start and end", () => {
    const start = createToolBlockState({
      type: "tool_start",
      at: new Date().toISOString(),
      toolName: "read",
      toolCallId: "call-1",
      args: { path: "README.md" },
    });

    expect(start.status).toBe("running");
    expect(start.expanded).toBe(false);

    const toggled = toggleToolBlockExpanded(start);
    expect(toggled.expanded).toBe(true);

    const end = completeToolBlockState(toggled, {
      type: "tool_end",
      at: new Date().toISOString(),
      toolName: "read",
      toolCallId: "call-1",
      ok: true,
      output: "# Relay\n",
    });

    expect(end.status).toBe("done");
    expect(end.output).toBe("# Relay\n");
    expect(end.expanded).toBe(true);
  });
});
