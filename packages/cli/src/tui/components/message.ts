import type {
  AgentMessageEvent,
  ErrorEvent,
  PlanEvent,
  StepEndEvent,
  StepStartEvent,
} from "@relay/schema";
import { ANSI, PREFIX, relayChevron } from "./theme.js";

export function formatAgentMessage(event: AgentMessageEvent): string[] {
  const prefix =
    event.role === "user"
      ? `${ANSI.dim}you${ANSI.reset}`
      : event.role === "system"
        ? `${ANSI.dim}system${ANSI.reset}`
        : PREFIX.agent;

  if (event.delta) {
    return [`${prefix} ${relayChevron()} ${event.text}`];
  }

  const lines = event.text.split("\n");
  if (lines.length === 1) {
    return [`${prefix} ${relayChevron()} ${lines[0]}`];
  }

  return [
    `${prefix} ${relayChevron()}`,
    ...lines.map((line) => `  ${line}`),
  ];
}

export function formatPlanEvent(event: PlanEvent): string[] {
  const waves = new Map<number, PlanEvent["steps"]>();
  for (const step of event.steps) {
    const bucket = waves.get(step.wave) ?? [];
    bucket.push(step);
    waves.set(step.wave, bucket);
  }

  const lines: string[] = [
    `${PREFIX.plan} ${relayChevron()} Plan (${event.steps.length} steps, ${waves.size} wave${waves.size === 1 ? "" : "s"})`,
  ];

  for (const wave of [...waves.keys()].sort((a, b) => a - b)) {
    const steps = waves.get(wave) ?? [];
    lines.push(`${PREFIX.plan} ${relayChevron()}   Wave ${wave}:`);
    for (const step of steps) {
      const harness = step.harness === "claude-code" ? "Claude Code" : capitalize(step.harness);
      lines.push(
        `${PREFIX.plan} ${relayChevron()}     • ${harness} — ${step.task}`,
      );
    }
  }

  return lines;
}

export function formatErrorEvent(event: ErrorEvent): string {
  const code = event.code ? ` ${ANSI.dim}(${event.code})${ANSI.reset}` : "";
  return `${PREFIX.error} ${relayChevron()} ${event.message}${code}`;
}

export function formatStepStartEvent(event: StepStartEvent): string {
  const idx = event.stepIndex !== undefined ? event.stepIndex + 1 : "?";
  const total = event.totalSteps ?? "?";
  return `${PREFIX.agent} ${relayChevron()} ▶ Step ${idx}/${total}: ${event.harness} running…`;
}

export function formatStepEndEvent(event: StepEndEvent): string {
  const icon = event.ok ? "✓" : "✗";
  const summary = event.summary ?? (event.ok ? "done" : "failed");
  return event.ok
    ? `${PREFIX.success} ${relayChevron()} ${icon} ${summary}`
    : `${PREFIX.error} ${relayChevron()} ${icon} ${summary}`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
