import type { HarnessId } from "@relay/schema";
import type { SessionEvent } from "@relay/session";

export type HandoffHop = {
  at: string;
  kind: "start" | "handoff" | "decision" | "other";
  from?: HarnessId | string;
  to?: HarnessId | string;
  label: string;
  reason?: string;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
};

export function harnessLabel(id: HarnessId | string | undefined): string {
  if (!id) return "—";
  return HARNESS_LABEL[id as HarnessId] ?? id;
}

export function parseHandoffHops(events: SessionEvent[]): HandoffHop[] {
  const hops: HandoffHop[] = [];

  for (const event of events) {
    const type = typeof event.event === "string" ? event.event : "unknown";
    const at = typeof event.at === "string" ? event.at : "";

    if (type === "session_started") {
      const harness = typeof event.harness === "string" ? event.harness : undefined;
      hops.push({
        at,
        kind: "start",
        to: harness,
        label: `Session started → ${harnessLabel(harness)}`,
      });
      continue;
    }

    if (type === "handoff_prepared") {
      const from = typeof event.from === "string" ? event.from : undefined;
      const to = typeof event.to === "string" ? event.to : undefined;
      const seq = typeof event.handoffSeq === "number" ? `#${event.handoffSeq}` : "";
      hops.push({
        at,
        kind: "handoff",
        from,
        to,
        label: `Handoff ${seq}: ${harnessLabel(from)} → ${harnessLabel(to)}`,
      });
      continue;
    }

    if (type === "decision_recorded") {
      const text = typeof event.text === "string" ? event.text : "";
      hops.push({
        at,
        kind: "decision",
        label: `Decision: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`,
      });
    }
  }

  return hops;
}

export function latestHarness(hops: HandoffHop[], fallback?: HarnessId): HarnessId | undefined {
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (hop.kind === "handoff" && hop.to) return hop.to as HarnessId;
    if (hop.kind === "start" && hop.to) return hop.to as HarnessId;
  }
  return fallback;
}
