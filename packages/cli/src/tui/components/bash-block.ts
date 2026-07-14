import type { ToolEndEvent, ToolStartEvent } from "@relay/schema";
import { ANSI, PREFIX, indentBody, relayChevron } from "./theme.js";
import {
  TOOL_EXPAND_KEYBIND,
  type ToolBlockRenderOptions,
  formatToolEndLine,
  formatToolStartLine,
  summarizeToolArgs,
} from "./tool-block.js";

const BASH_TOOL_NAMES = new Set(["bash", "shell", "exec", "run_terminal_cmd"]);

export function isBashTool(toolName: string): boolean {
  return BASH_TOOL_NAMES.has(toolName.toLowerCase());
}

export function formatBashStartLine(
  event: ToolStartEvent,
  options?: ToolBlockRenderOptions,
): string {
  const command =
    typeof event.args?.command === "string" ? event.args.command : summarizeToolArgs(event.toolName, event.args);
  const hint = options?.showExpandHint === false ? "" : `  ${ANSI.dim}[${TOOL_EXPAND_KEYBIND}]${ANSI.reset}`;
  return `${PREFIX.bash} ${relayChevron()} ▶ ${command}${hint}`;
}

export function formatBashEndLines(
  event: ToolEndEvent,
  options?: ToolBlockRenderOptions,
): string[] {
  const expanded = options?.expanded ?? false;
  const icon = event.ok ? (expanded ? "▼" : "✓") : "✗";
  const exit = event.ok ? "exit 0" : "exit 1";
  const header = `${PREFIX.bash} ${relayChevron()} ${icon} bash  ${ANSI.dim}(${exit})${ANSI.reset}`;

  if (!expanded || !event.output?.trim()) {
    return [header];
  }

  return [header, ...indentBody(event.output.split("\n"))];
}

/** Bash-specific rendering; falls back to generic tool lines when not a shell tool. */
export function formatBashOrToolStart(
  event: ToolStartEvent,
  options?: ToolBlockRenderOptions,
): string {
  return isBashTool(event.toolName)
    ? formatBashStartLine(event, options)
    : formatToolStartLine(event.toolName, event.args, options);
}

export function formatBashOrToolEnd(
  event: ToolEndEvent,
  options?: ToolBlockRenderOptions,
): string[] {
  return isBashTool(event.toolName)
    ? formatBashEndLines(event, options)
    : formatToolEndLine(event.toolName, event.ok, event.output, options);
}
