import type { HarnessEvent, ToolEndEvent } from "@relay/schema";
import {
  completeToolBlockState,
  createToolBlockState,
  formatAgentMessage,
  formatBashOrToolEnd,
  formatBashOrToolStart,
  formatErrorEvent,
  formatPlanEvent,
  formatStepEndEvent,
  formatStepStartEvent,
  toolBlockKey,
  toggleToolBlockExpanded,
  type ToolBlockState,
} from "./components/index.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

export type TranscriptKind = "plan" | "tool" | "agent" | "error" | "success" | "info";

export type TranscriptEntry = {
  kind: TranscriptKind;
  text: string;
  raw: string;
};

export type TranscriptRenderContext = {
  toolBlocks: Map<string, ToolBlockState>;
  expandedTools: Set<string>;
};

export type TranscriptRenderResult = {
  entries: TranscriptEntry[];
  lines: string[];
  context: TranscriptRenderContext;
};

export type { HarnessEvent };

export function createTranscriptContext(): TranscriptRenderContext {
  return {
    toolBlocks: new Map(),
    expandedTools: new Set(),
  };
}

export function toggleTranscriptToolExpand(
  context: TranscriptRenderContext,
  toolKey: string,
): TranscriptRenderContext {
  const nextExpanded = new Set(context.expandedTools);
  if (nextExpanded.has(toolKey)) {
    nextExpanded.delete(toolKey);
  } else {
    nextExpanded.add(toolKey);
  }

  const nextBlocks = new Map(context.toolBlocks);
  const existing = nextBlocks.get(toolKey);
  if (existing) {
    nextBlocks.set(toolKey, toggleToolBlockExpanded(existing));
  }

  return { toolBlocks: nextBlocks, expandedTools: nextExpanded };
}

export function findLatestToggleableToolKey(context: TranscriptRenderContext): string | null {
  let latest: string | null = null;
  for (const [key, state] of context.toolBlocks) {
    if (state.status !== "running") {
      latest = key;
    }
  }
  return latest;
}

function isToolExpanded(
  context: TranscriptRenderContext,
  key: string,
  state?: ToolBlockState,
): boolean {
  if (context.expandedTools.has(key)) return true;
  return state?.expanded ?? false;
}

function entry(kind: TranscriptKind, line: string): TranscriptEntry {
  return { kind, text: line.trim(), raw: line };
}

export function classifyHarnessEvent(event: HarnessEvent): TranscriptKind {
  switch (event.type) {
    case "plan":
      return "plan";
    case "step_start":
    case "agent_start":
    case "agent_message":
      return "agent";
    case "step_end":
      return event.ok ? "success" : "error";
    case "tool_start":
    case "tool_end":
      return "tool";
    case "error":
      return "error";
    case "handoff":
    case "retry_start":
    case "retry_end":
    case "agent_end":
      return "info";
  }
}

/** Route a typed harness event to transcript components (Sprint 4). */
export function renderHarnessEvent(
  event: HarnessEvent,
  context: TranscriptRenderContext = createTranscriptContext(),
): TranscriptRenderResult {
  const nextContext: TranscriptRenderContext = {
    toolBlocks: new Map(context.toolBlocks),
    expandedTools: new Set(context.expandedTools),
  };

  const lines: string[] = [];
  const entries: TranscriptEntry[] = [];

  const push = (kind: TranscriptKind, rendered: string | string[]) => {
    const batch = Array.isArray(rendered) ? rendered : [rendered];
    for (const line of batch) {
      lines.push(line);
      entries.push(entry(kind, line));
    }
  };

  switch (event.type) {
    case "tool_start": {
      const state = createToolBlockState(event);
      const key = toolBlockKey(state);
      nextContext.toolBlocks.set(key, state);
      push(
        "tool",
        formatBashOrToolStart(event, {
          expanded: isToolExpanded(nextContext, key, state),
        }),
      );
      break;
    }
    case "tool_end": {
      const key = event.toolCallId ?? event.toolName;
      const prior = nextContext.toolBlocks.get(key);
      const state = prior
        ? completeToolBlockState(prior, event)
        : completeToolBlockState(
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: event.ok ? "done" : "error",
              expanded: false,
              ok: event.ok,
              output: event.output,
            },
            event,
          );
      nextContext.toolBlocks.set(key, state);
      push(
        "tool",
        formatBashOrToolEnd(event, {
          expanded: isToolExpanded(nextContext, key, state),
        }),
      );
      break;
    }
    case "agent_message":
      push("agent", formatAgentMessage(event));
      break;
    case "plan":
      push("plan", formatPlanEvent(event));
      break;
    case "error":
      push("error", formatErrorEvent(event));
      break;
    case "step_start":
      push("agent", formatStepStartEvent(event));
      break;
    case "step_end":
      push(classifyHarnessEvent(event), formatStepEndEvent(event));
      break;
    case "agent_start":
      push("agent", `${ANSI.yellow}agent${ANSI.reset} ${ANSI.bold}›${ANSI.reset} agent started`);
      break;
    case "agent_end":
      push("info", `${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} agent settled`);
      break;
    case "handoff": {
      const from = event.from ? `${event.from} ` : "";
      const seq = event.handoffSeq !== undefined ? ` · handoff #${event.handoffSeq}` : "";
      push(
        "info",
        `${ANSI.dim}handoff${ANSI.reset} ${ANSI.bold}›${ANSI.reset} ${from}──► ${event.to}${seq}`,
      );
      break;
    }
    case "retry_start":
      push(
        "info",
        `${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} retrying…${event.reason ? ` (${event.reason})` : ""}`,
      );
      break;
    case "retry_end":
      push(
        "info",
        event.ok === false
          ? `${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} retry failed`
          : `${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} retry done`,
      );
      break;
    default:
      break;
  }

  return { entries, lines, context: nextContext };
}

/** Re-render a tool_end block with current expand state (for Ctrl+O toggle). */
export function renderToolEndLines(
  event: ToolEndEvent,
  context: TranscriptRenderContext,
): string[] {
  const key = event.toolCallId ?? event.toolName;
  const state = context.toolBlocks.get(key);
  return formatBashOrToolEnd(event, {
    expanded: isToolExpanded(context, key, state),
  });
}

/** Render a typed harness event as plain transcript lines (backward compat). */
export function harnessEventToLines(event: HarnessEvent): string[] {
  return renderHarnessEvent(event).lines;
}

/** Render a typed harness event as a single transcript line when possible. */
export function harnessEventToLine(event: HarnessEvent): string {
  return harnessEventToLines(event).join("\n");
}

/** Sprint 2 plain-string adapter (orchestrator onLine compat). */
export function formatHarnessEvent(event: HarnessEvent): string | null {
  switch (event.type) {
    case "step_start": {
      const idx = event.stepIndex !== undefined ? event.stepIndex + 1 : "?";
      const total = event.totalSteps ?? "?";
      return `▶ Step ${idx}/${total}: ${event.harness} running…`;
    }
    case "step_end":
      return event.ok ? `  ✓ ${event.summary ?? "done"}` : `  ✗ ${event.summary ?? "failed"}`;
    case "tool_start":
      return `tool ▶ ${event.toolName}`;
    case "tool_end":
      return event.ok ? `tool ✓ ${event.toolName}` : `tool ✗ ${event.toolName}`;
    case "agent_message":
      if (event.delta) return null;
      return event.text ?? `message (${event.role})`;
    case "agent_start":
      return "agent started";
    case "agent_end":
      return "agent settled";
    case "plan": {
      const waves = new Set(event.steps.map((step) => step.wave)).size;
      return `Plan (${event.steps.length} steps, ${waves} wave(s))`;
    }
    case "error":
      return `error: ${event.message}`;
    case "handoff":
      return event.from
        ? `handoff: ${event.from} → ${event.to}`
        : `handoff → ${event.to}`;
    case "retry_start":
      return `retrying…${event.reason ? ` (${event.reason})` : ""}`;
    case "retry_end":
      return event.ok === false ? "retry failed" : "retry done";
  }
}

/** @deprecated Use formatHarnessEvent */
export const harnessEventToLineLegacy = formatHarnessEvent;

export function classifyLine(line: string): TranscriptKind {
  const trimmed = line.trim();
  if (!trimmed) return "info";

  if (
    /^Plan\s*\(/i.test(trimmed) ||
    /^Wave\s+\d/i.test(trimmed) ||
    /^\s*[•·]/.test(trimmed) ||
    /^Session:/i.test(trimmed)
  ) {
    return "plan";
  }

  if (/^tool\s+[▶✓✗▼]/i.test(trimmed) || /^\s*│\s*tool/i.test(trimmed)) {
    return "tool";
  }

  if (/^bash\s+[▶✓✗▼]/i.test(trimmed)) {
    return "tool";
  }

  if (/^\s*│/.test(trimmed) && !/tool/i.test(trimmed)) {
    return "tool";
  }

  if (/^▶\s*Step/i.test(trimmed) || /^agent:/i.test(trimmed) || /running…/i.test(trimmed)) {
    return "agent";
  }

  if (/^[✗⊘]/.test(trimmed) || /\bfailed\b/i.test(trimmed) || /Cancelled/i.test(trimmed)) {
    return "error";
  }

  if (/^✓/.test(trimmed) || /Done — all steps complete/i.test(trimmed)) {
    return "success";
  }

  if (/^↪/.test(trimmed) || /^Verification:/i.test(trimmed)) {
    return "info";
  }

  return "info";
}

const PREFIX: Record<TranscriptKind, string> = {
  plan: `${ANSI.cyan}plan${ANSI.reset}`,
  tool: `${ANSI.magenta}tool${ANSI.reset}`,
  agent: `${ANSI.yellow}agent${ANSI.reset}`,
  error: `${ANSI.red}err${ANSI.reset}`,
  success: `${ANSI.green}ok${ANSI.reset}`,
  info: `${ANSI.dim}relay${ANSI.reset}`,
};

export function formatTranscriptEntry(entry: TranscriptEntry): string {
  if (entry.raw.includes("\x1b[")) {
    return entry.raw;
  }

  const prefix = PREFIX[entry.kind];
  const body =
    entry.kind === "tool" && !entry.text.startsWith("tool")
      ? entry.text.replace(/^\s*│\s*/, "")
      : entry.text;
  return `${prefix} ${ANSI.bold}›${ANSI.reset} ${body}`;
}

export function parseHarnessEvent(
  event: HarnessEvent,
  context?: TranscriptRenderContext,
): TranscriptEntry | null {
  const rendered = renderHarnessEvent(event, context);
  const first = rendered.entries[0];
  if (first) return first;
  const fallback = formatHarnessEvent(event);
  if (!fallback) return null;
  return {
    kind: classifyHarnessEvent(event),
    text: fallback.trim(),
    raw: fallback,
  };
}

export function parseOrchestratorLine(line: string): TranscriptEntry {
  const kind = classifyLine(line);
  return { kind, text: line.trim(), raw: line };
}

export function formatRelayBanner(goal?: string): string {
  const goalLine = goal
    ? `${ANSI.dim}goal${ANSI.reset} ${ANSI.bold}${goal.slice(0, 60)}${goal.length > 60 ? "…" : ""}${ANSI.reset}`
    : `${ANSI.dim}type what you want to build${ANSI.reset}`;
  return (
    `${ANSI.bold}${ANSI.cyan}Relay${ANSI.reset} ${ANSI.dim}· personal dev agent mesh${ANSI.reset}\n` +
    `${goalLine}\n` +
    `${ANSI.dim}commands: status · agents · models · config · quit${ANSI.reset}`
  );
}
