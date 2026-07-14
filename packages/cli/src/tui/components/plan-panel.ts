import type { HarnessId, PlanEvent, PlanStepEvent } from "@relay/schema";
import { ANSI, PREFIX, relayChevron } from "./theme.js";

export type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "manual";

export type PlanPanelOptions = {
  /** Highlight the active step id. */
  activeStepId?: string;
  /** Per-step status for live plan rail updates. */
  statuses?: Record<string, PlanStepStatus>;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  pi: "Pi",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

const HARNESS_ACCENT: Record<HarnessId, string> = {
  pi: ANSI.cyan,
  "claude-code": ANSI.yellow,
  codex: ANSI.green,
  cursor: ANSI.magenta,
};

function label(harness: HarnessId): string {
  return HARNESS_LABEL[harness] ?? harness;
}

function accent(harness: HarnessId): string {
  return HARNESS_ACCENT[harness] ?? ANSI.dim;
}

function statusIcon(status?: PlanStepStatus): string {
  switch (status) {
    case "running":
      return `${ANSI.yellow}▶${ANSI.reset}`;
    case "done":
      return `${ANSI.green}✓${ANSI.reset}`;
    case "failed":
      return `${ANSI.red}✗${ANSI.reset}`;
    case "skipped":
      return `${ANSI.dim}⊘${ANSI.reset}`;
    default:
      return `${ANSI.dim}○${ANSI.reset}`;
  }
}

function groupStepsByWave(steps: PlanStepEvent[]): Map<number, PlanStepEvent[]> {
  const waves = new Map<number, PlanStepEvent[]>();
  for (const step of steps) {
    const bucket = waves.get(step.wave) ?? [];
    bucket.push(step);
    waves.set(step.wave, bucket);
  }
  return new Map([...waves.entries()].sort((a, b) => a[0] - b[0]));
}

/** Render a wave-aware plan panel with parallel agent grouping. */
export function formatPlanPanel(event: PlanEvent, options: PlanPanelOptions = {}): string[] {
  const waves = groupStepsByWave(event.steps);
  const lines: string[] = [
    `${PREFIX.plan} ${relayChevron()} Plan (${event.steps.length} steps, ${waves.size} wave${waves.size === 1 ? "" : "s"})`,
  ];

  for (const [wave, steps] of waves) {
    const parallel = steps.length > 1;
    const waveLabel = parallel
      ? `Wave ${wave} [parallel · ${steps.length} agents]`
      : `Wave ${wave}`;
    lines.push(`${PREFIX.plan} ${relayChevron()}   ${waveLabel}:`);

    for (const step of steps) {
      const status = options.statuses?.[step.id];
      const marker =
        options.activeStepId === step.id || status === "running" ? `${ANSI.bold}►${ANSI.reset} ` : "  ";
      const icon = statusIcon(status);
      const harnessColor = accent(step.harness);
      const harnessName = `${harnessColor}${label(step.harness)}${ANSI.reset}`;
      lines.push(
        `${PREFIX.plan} ${relayChevron()} ${marker}${icon} ${harnessName} — ${step.task}`,
      );
    }
  }

  return lines;
}

/** Compact one-line summary for footer or header. */
export function formatPlanSummary(event: PlanEvent): string {
  const waves = groupStepsByWave(event.steps);
  const parallelWaves = [...waves.values()].filter((steps) => steps.length > 1).length;
  const parallelHint = parallelWaves > 0 ? ` · ${parallelWaves} parallel` : "";
  return `${event.steps.length} steps · ${waves.size} wave${waves.size === 1 ? "" : "s"}${parallelHint}`;
}
