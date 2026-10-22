import type { SessionEvent } from "@relay/session";
import { harnessLabel } from "../tui/hops.js";

export type FailoverReason = "auth" | "capability" | "verify" | "none";

export type TraceHop = {
  index: number;
  at: string;
  kind: "start" | "handoff" | "routing";
  from?: string;
  to?: string;
  handoffSeq?: number;
  stepId?: string;
  harness?: string;
  model?: string;
  modelTier?: string;
  taskType?: string;
  ok?: boolean;
  verifyOk?: boolean;
  failoverUsed?: boolean;
  failoverReason?: FailoverReason;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  reason?: string;
  summary?: string;
  events: SessionEvent[];
};

export type TraceAudit = {
  sessionId: string;
  eventCount: number;
  hopCount: number;
  hops: TraceHop[];
  otherEvents: SessionEvent[];
};

const HOP_EVENT_TYPES = new Set([
  "handoff_prepared",
  "routing_outcome",
  "harness_complete",
  "graph_node",
  "verify_outcome",
]);
const FAILOVER_REASONS = new Set<FailoverReason>(["auth", "capability", "verify"]);

function eventType(event: SessionEvent): string {
  return typeof event.event === "string" ? event.event : "unknown";
}

function eventAt(event: SessionEvent): string {
  return typeof event.at === "string" ? event.at : "";
}

function strField(event: SessionEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function numField(event: SessionEvent, key: string): number | undefined {
  const value = event[key];
  return typeof value === "number" ? value : undefined;
}

function boolField(event: SessionEvent, key: string): boolean | undefined {
  const value = event[key];
  return typeof value === "boolean" ? value : undefined;
}

function failoverReasonField(event: SessionEvent): FailoverReason | undefined {
  const value = strField(event, "failoverReason");
  if (value === "auth" || value === "capability" || value === "verify" || value === "none") {
    return value;
  }
  return undefined;
}

function mergeRoutingFields(hop: TraceHop, event: SessionEvent): void {
  hop.harness = strField(event, "harness") ?? hop.harness ?? hop.to;
  hop.model = strField(event, "model") ?? hop.model;
  hop.modelTier = strField(event, "modelTier") ?? hop.modelTier;
  hop.stepId = strField(event, "stepId") ?? hop.stepId;
  hop.taskType = strField(event, "taskType") ?? hop.taskType;
  hop.ok = boolField(event, "ok") ?? hop.ok;
  hop.verifyOk = boolField(event, "verifyOk") ?? hop.verifyOk;
  hop.failoverUsed = boolField(event, "failoverUsed") ?? hop.failoverUsed;
  hop.failoverReason = failoverReasonField(event) ?? hop.failoverReason;
  hop.costUsd = numField(event, "costUsd") ?? hop.costUsd;
  hop.inputTokens = numField(event, "inputTokens") ?? hop.inputTokens;
  hop.outputTokens = numField(event, "outputTokens") ?? hop.outputTokens;
  hop.reason = strField(event, "reason") ?? hop.reason;
  hop.summary = strField(event, "summary") ?? hop.summary;
}

function finalizeHop(hop: TraceHop): TraceHop {
  hop.harness = hop.harness ?? hop.to;
  return hop;
}

function newHopFromHandoff(event: SessionEvent, index: number): TraceHop {
  return finalizeHop({
    index,
    at: eventAt(event),
    kind: "handoff",
    from: strField(event, "from"),
    to: strField(event, "to"),
    handoffSeq: numField(event, "handoffSeq"),
    harness: strField(event, "to"),
    events: [event],
  });
}

function newHopFromRouting(event: SessionEvent, index: number): TraceHop {
  const hop: TraceHop = {
    index,
    at: eventAt(event),
    kind: "routing",
    events: [event],
  };
  mergeRoutingFields(hop, event);
  return finalizeHop(hop);
}

/** Group handoff_prepared, harness_complete, and routing_outcome into audit hops. */
export function buildTraceAudit(sessionId: string, events: SessionEvent[]): TraceAudit {
  const hops: TraceHop[] = [];
  const otherEvents: SessionEvent[] = [];
  let current: TraceHop | null = null;
  let hopIndex = 0;

  for (const event of events) {
    const type = eventType(event);

    if (type === "session_started") {
      hopIndex += 1;
      hops.push(
        finalizeHop({
          index: hopIndex,
          at: eventAt(event),
          kind: "start",
          to: strField(event, "harness"),
          harness: strField(event, "harness"),
          events: [event],
        }),
      );
      current = null;
      continue;
    }

    if (type === "handoff_prepared") {
      if (current) hops.push(finalizeHop(current));
      hopIndex += 1;
      current = newHopFromHandoff(event, hopIndex);
      continue;
    }

    if (type === "harness_complete" || type === "routing_outcome") {
      if (!current) {
        hopIndex += 1;
        current = newHopFromRouting(event, hopIndex);
      } else {
        current.events.push(event);
        mergeRoutingFields(current, event);
      }

      if (type === "routing_outcome") {
        hops.push(finalizeHop(current));
        current = null;
      }
      continue;
    }

    if (type === "graph_node" || type === "verify_outcome") {
      if (!current) {
        hopIndex += 1;
        current = newHopFromRouting(event, hopIndex);
      } else {
        current.events.push(event);
        mergeRoutingFields(current, event);
      }
      continue;
    }

    if (HOP_EVENT_TYPES.has(type)) {
      otherEvents.push(event);
      continue;
    }

    otherEvents.push(event);
  }

  if (current) hops.push(finalizeHop(current));

  return {
    sessionId,
    eventCount: events.length,
    hopCount: hops.length,
    hops,
    otherEvents,
  };
}

export function isFailoverHop(hop: TraceHop): boolean {
  if (hop.failoverUsed === true) return true;
  const reason = hop.failoverReason;
  return reason !== undefined && FAILOVER_REASONS.has(reason);
}

function formatCost(costUsd: number | undefined): string | undefined {
  if (costUsd === undefined) return undefined;
  return `$${costUsd.toFixed(4)}`;
}

function formatRoutingDetails(hop: TraceHop): string[] {
  const parts: string[] = [];
  if (hop.harness) parts.push(`harness=${hop.harness}`);
  if (hop.modelTier) parts.push(`modelTier=${hop.modelTier}`);
  if (hop.model) parts.push(`model=${hop.model}`);
  if (hop.stepId) parts.push(`step=${hop.stepId}`);
  if (hop.taskType) parts.push(`taskType=${hop.taskType}`);
  if (hop.failoverReason && hop.failoverReason !== "none") {
    parts.push(`failoverReason=${hop.failoverReason}`);
  } else if (hop.failoverUsed) {
    parts.push("failover=true");
  }
  const cost = formatCost(hop.costUsd);
  if (cost) parts.push(`costUsd=${cost}`);
  if (hop.inputTokens !== undefined) parts.push(`inputTokens=${hop.inputTokens}`);
  if (hop.outputTokens !== undefined) parts.push(`outputTokens=${hop.outputTokens}`);
  if (hop.reason) parts.push(`reason=${hop.reason}`);
  if (hop.ok !== undefined) parts.push(`ok=${hop.ok}`);
  if (hop.verifyOk !== undefined) parts.push(`verifyOk=${hop.verifyOk}`);
  return parts;
}

function formatGraphEvent(event: SessionEvent): string | undefined {
  const type = eventType(event);
  if (type !== "graph_node" && type !== "verify_outcome") return undefined;

  if (type === "graph_node") {
    const ok = boolField(event, "ok") ? "PASS" : "FAIL";
    const nodeId = strField(event, "nodeId") ?? "node";
    const nodeType = strField(event, "nodeType") ?? "node";
    const duration = numField(event, "durationMs");
    const evidence = strField(event, "evidence");
    return `graph ${ok} ${nodeId} (${nodeType}${duration !== undefined ? `, ${duration}ms` : ""})${evidence ? `: ${evidence}` : ""}`;
  }

  const ok = boolField(event, "ok") ? "PASS" : "FAIL";
  const verifierId = strField(event, "verifierId") ?? "verifier";
  const evidence = strField(event, "evidence");
  return `verify ${ok} ${verifierId}${evidence ? `: ${evidence}` : ""}`;
}

function hopTitle(hop: TraceHop): string {
  if (hop.kind === "start") {
    return `Session started → ${harnessLabel(hop.harness ?? hop.to)}`;
  }

  const seq = hop.handoffSeq !== undefined ? `#${hop.handoffSeq} ` : "";
  if (hop.from || hop.to) {
    return `Handoff ${seq}${harnessLabel(hop.from)} → ${harnessLabel(hop.to ?? hop.harness)}`;
  }

  const harness = harnessLabel(hop.harness);
  const step = hop.stepId ? ` (${hop.stepId})` : "";
  return `Routing${step} → ${harness}`;
}

export function formatTraceHuman(audit: TraceAudit): string {
  const lines: string[] = [
    `Session: ${audit.sessionId}`,
    `Events: ${audit.eventCount}`,
    `Hops: ${audit.hopCount}`,
    "",
  ];

  for (const hop of audit.hops) {
    const failoverTag = isFailoverHop(hop)
      ? ` ⚠ FAILOVER (${hop.failoverReason ?? "reroute"})`
      : "";
    lines.push(`[Hop ${hop.index}]${failoverTag} ${hop.at}`);
    lines.push(`  ${hopTitle(hop)}`);

    const details = formatRoutingDetails(hop);
    if (details.length > 0) {
      lines.push(`  ${details.join("  ")}`);
    }
    if (hop.summary) {
      lines.push(`  summary: ${hop.summary}`);
    }
    for (const event of hop.events) {
      const rendered = formatGraphEvent(event);
      if (rendered) lines.push(`  ${rendered}`);
    }
    lines.push("");
  }

  if (audit.otherEvents.length > 0) {
    lines.push("Other events:");
    for (const event of audit.otherEvents) {
      const at = eventAt(event);
      const type = eventType(event);
      const fields = Object.entries(event)
        .filter(([key]) => key !== "at" && key !== "event")
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ");
      lines.push(`${at}  ${type}${fields ? `  ${fields}` : ""}`);
    }
  }

  return lines.join("\n").trimEnd();
}

export function formatTraceJson(audit: TraceAudit): string {
  return JSON.stringify(
    {
      ...audit,
      hops: audit.hops.map((hop) => ({
        ...hop,
        failover: isFailoverHop(hop),
        label: hopTitle(hop),
      })),
    },
    null,
    2,
  );
}
