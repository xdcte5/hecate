import type { HarnessEvent, HarnessId, PlanStepEvent } from "@relay/schema";
export type PiRpcEvent = Record<string, unknown> & { type: string };

export type HarnessEventHandler = (event: HarnessEvent) => void;

/** Lightweight pub/sub for typed harness events (Sprint 2 TUI wiring). */
export class HarnessEventEmitter {
  private readonly handlers = new Set<HarnessEventHandler>();

  on(handler: HarnessEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: HarnessEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

function now(): string {
  return new Date().toISOString();
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter(
      (part): part is { type?: string; text?: string } =>
        !!part && typeof part === "object" && (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function recordArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Map a Pi RPC stdout JSONL event to a Relay HarnessEvent (or null if unhandled). */
export function mapPiEventToHarnessEvent(
  raw: PiRpcEvent,
  harness?: HarnessId,
): HarnessEvent | null {
  const at = now();

  switch (raw.type) {
    case "agent_start":
      return { type: "agent_start", at, harness };

    case "agent_end":
    case "agent_settled":
      return { type: "agent_end", at, harness };

    case "tool_execution_start":
      return {
        type: "tool_start",
        at,
        toolName: str(raw.toolName) ?? "tool",
        toolCallId: str(raw.toolCallId),
        args: recordArgs(raw.args),
      };

    case "tool_execution_end": {
      const result = raw.result as { content?: Array<{ text?: string }> } | undefined;
      const output = result?.content
        ?.map((part) => part.text)
        .filter((text): text is string => typeof text === "string")
        .join("\n");
      return {
        type: "tool_end",
        at,
        toolName: str(raw.toolName) ?? "tool",
        toolCallId: str(raw.toolCallId),
        ok: raw.isError !== true,
        output: output || undefined,
      };
    }

    case "message_update": {
      const assistantEvent = raw.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
        return {
          type: "agent_message",
          at,
          role: "assistant",
          text: assistantEvent.delta,
          delta: true,
        };
      }
      if (assistantEvent?.type === "error") {
        return {
          type: "error",
          at,
          message: assistantEvent.delta ?? "Agent error",
          code: "agent_error",
        };
      }
      return null;
    }

    case "message_end": {
      const message = raw.message as { role?: string } | undefined;
      const role = message?.role;
      if (role !== "assistant" && role !== "user" && role !== "system") return null;
      const text = extractAssistantText(raw.message);
      if (!text) return null;
      return { type: "agent_message", at, role, text };
    }

    case "auto_retry_start":
      return {
        type: "retry_start",
        at,
        reason: str(raw.errorMessage) ?? "auto retry",
      };

    case "auto_retry_end":
      return {
        type: "retry_end",
        at,
        ok: raw.success === true,
      };

    case "extension_error":
      return {
        type: "error",
        at,
        message: str(raw.error) ?? "Extension error",
        code: "extension_error",
      };

    default:
      return null;
  }
}

/** Human-readable line for terminal output (Sprint 1 string adapter). */
export function formatHarnessEventLine(event: HarnessEvent): string | null {
  switch (event.type) {
    case "step_start": {
      const idx = event.stepIndex !== undefined ? event.stepIndex + 1 : "?";
      const total = event.totalSteps ?? "?";
      return `▶ Step ${idx}/${total}: ${event.harness} running…`;
    }
    case "step_end":
      return event.ok ? `  ✓ ${event.summary ?? "done"}` : `  ✗ ${event.summary ?? "failed"}`;
    case "agent_start":
      return "agent started";
    case "agent_end":
      return "agent settled";
    case "tool_start":
      return `tool ▶ ${event.toolName}`;
    case "tool_end":
      return event.ok ? `tool ✓ ${event.toolName}` : `tool ✗ ${event.toolName}`;
    case "agent_message":
      return event.delta ? null : `message (${event.role})`;
    case "retry_start":
      return "retrying…";
    case "retry_end":
      return event.ok === false ? "retry failed" : "retry done";
    case "error":
      return `error: ${event.message}`;
    case "plan": {
      const count = event.steps.length;
      const waves = new Set(event.steps.map((s) => s.wave)).size;
      return `Plan (${count} steps, ${waves} wave(s))`;
    }
    case "handoff":
      return event.from
        ? `handoff: ${event.from} → ${event.to}`
        : `handoff → ${event.to}`;
    default:
      return null;
  }
}

export function emitOrchestratorEvent(
  event: HarnessEvent,
  handlers?: { onEvent?: (event: HarnessEvent) => void; onLine?: (line: string) => void },
): void {
  handlers?.onEvent?.(event);
  // TUI renders rich events via onEvent — skip string adapter to avoid duplicate lines.
  if (handlers?.onEvent) return;
  const line = formatHarnessEventLine(event);
  if (line) handlers?.onLine?.(line);
}

export function makeStepStartEvent(
  step: { id: string; harness: HarnessId; task: string; wave: number },
  stepIndex: number,
  totalSteps: number,
): HarnessEvent {
  return {
    type: "step_start",
    at: now(),
    stepId: step.id,
    harness: step.harness,
    task: step.task,
    wave: step.wave,
    stepIndex,
    totalSteps,
  };
}

export function makeStepEndEvent(
  step: { id: string; harness: HarnessId },
  ok: boolean,
  summary: string,
): HarnessEvent {
  return {
    type: "step_end",
    at: now(),
    stepId: step.id,
    harness: step.harness,
    ok,
    summary,
  };
}

export function makePlanEvent(steps: PlanStepEvent[]): HarnessEvent {
  return {
    type: "plan",
    at: now(),
    steps,
  };
}

export function makeErrorEvent(message: string, code?: string): HarnessEvent {
  return {
    type: "error",
    at: now(),
    message,
    ...(code ? { code } : {}),
  };
}
