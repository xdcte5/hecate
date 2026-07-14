import type { ToolEndEvent, ToolStartEvent } from "@relay/schema";
import { ANSI, PREFIX, indentBody, relayChevron } from "./theme.js";

/** Toggle expand in relay-tui.ts (Ctrl+O / empty-line `o`). */
export const TOOL_EXPAND_KEYBIND = "Ctrl+O";

export type ToolBlockStatus = "running" | "done" | "error";

export type ToolBlockState = {
  toolCallId?: string;
  toolName: string;
  status: ToolBlockStatus;
  expanded: boolean;
  args?: Record<string, unknown>;
  output?: string;
  ok?: boolean;
};

export type ToolBlockRenderOptions = {
  expanded?: boolean;
  maxPreviewLines?: number;
  showExpandHint?: boolean;
};

const DEFAULT_MAX_PREVIEW = 8;

export function toolStatusIcon(status: ToolBlockStatus, expanded?: boolean): string {
  if (status === "running") return "▶";
  if (status === "error") return "✗";
  if (expanded) return "▼";
  return "✓";
}

export function summarizeToolArgs(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return toolName;

  const path =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : typeof args.filePath === "string"
          ? args.filePath
          : undefined;

  if (path) return `${toolName}  ${path}`;

  const command = typeof args.command === "string" ? args.command : undefined;
  if (command) return `${toolName}  ${command}`;

  const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
  if (pattern) return `${toolName}  ${pattern}`;

  const query = typeof args.query === "string" ? args.query : undefined;
  if (query) return `${toolName}  ${query}`;

  return toolName;
}

function expandHint(options?: ToolBlockRenderOptions): string {
  if (options?.showExpandHint === false) return "";
  return `  ${ANSI.dim}[${TOOL_EXPAND_KEYBIND}]${ANSI.reset}`;
}

function previewOutput(output: string, maxLines: number): string[] {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return lines;
  const head = lines.slice(0, maxLines);
  head.push(`${ANSI.dim}… (${lines.length - maxLines} more lines)${ANSI.reset}`);
  return head;
}

export function formatToolStartLine(
  toolName: string,
  args?: Record<string, unknown>,
  options?: ToolBlockRenderOptions,
): string {
  const summary = summarizeToolArgs(toolName, args);
  const icon = toolStatusIcon("running");
  return `${PREFIX.tool} ${relayChevron()} ${icon} ${summary}${expandHint(options)}`;
}

export function formatToolEndLine(
  toolName: string,
  ok: boolean,
  output?: string,
  options?: ToolBlockRenderOptions,
): string[] {
  const expanded = options?.expanded ?? false;
  const status: ToolBlockStatus = ok ? "done" : "error";
  const icon = toolStatusIcon(status, expanded);
  const summary = summarizeToolArgs(toolName);
  const header = `${PREFIX.tool} ${relayChevron()} ${icon} ${summary}`;

  if (!expanded || !output?.trim()) {
    const suffix =
      status === "done" && output?.trim()
        ? ` ${ANSI.dim}(${output.split("\n").length} lines)${ANSI.reset}`
        : status === "error" && output?.trim()
          ? ` ${ANSI.red}${output.split("\n")[0]}${ANSI.reset}`
          : "";
    return [`${header}${suffix}`];
  }

  const body = previewOutput(output, options?.maxPreviewLines ?? DEFAULT_MAX_PREVIEW);
  return [header, ...indentBody(body)];
}

export function formatToolStartEvent(
  event: ToolStartEvent,
  options?: ToolBlockRenderOptions,
): string {
  return formatToolStartLine(event.toolName, event.args, options);
}

export function formatToolEndEvent(
  event: ToolEndEvent,
  options?: ToolBlockRenderOptions,
): string[] {
  return formatToolEndLine(event.toolName, event.ok, event.output, options);
}

export function createToolBlockState(event: ToolStartEvent): ToolBlockState {
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status: "running",
    expanded: false,
    args: event.args,
  };
}

export function completeToolBlockState(
  state: ToolBlockState,
  event: ToolEndEvent,
): ToolBlockState {
  return {
    ...state,
    status: event.ok ? "done" : "error",
    ok: event.ok,
    output: event.output,
  };
}

export function toggleToolBlockExpanded(state: ToolBlockState): ToolBlockState {
  return { ...state, expanded: !state.expanded };
}

export function toolBlockKey(state: ToolBlockState): string {
  return state.toolCallId ?? state.toolName;
}
