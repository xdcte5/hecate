import type { RhpV1 } from "@relay/schema";
import type { RunState } from "@relay/orchestrator";
import type { HandoffHop } from "./hops.js";
import { harnessLabel, latestHarness } from "./hops.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgBlue: "\x1b[44m",
  bgGray: "\x1b[100m",
};

function harnessColor(id: string): string {
  switch (id) {
    case "claude-code":
      return ANSI.yellow;
    case "codex":
      return ANSI.green;
    case "cursor":
      return ANSI.cyan;
    case "pi":
      return ANSI.magenta;
    default:
      return ANSI.white;
  }
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "??:??";
  }
}

export type DashView = {
  session: RhpV1 | null;
  hops: HandoffHop[];
  runState?: RunState | null;
  projectName: string;
  width: number;
  height: number;
  input?: string;
  message?: string;
  messageTone?: "ok" | "hint" | "error";
};

export const DASH_INPUT_HINT =
  "Type goal · launch · done · next · status · reset · help · quit";

export function renderDashboard(view: DashView): string {
  const w = Math.max(60, Math.min(view.width, 120));
  const inner = w - 4;
  const lines: string[] = [];

  const title = `${ANSI.bold}${ANSI.cyan}RELAY${ANSI.reset} ${ANSI.dim}personal dev agent mesh${ANSI.reset}`;
  lines.push(`┌${"─".repeat(w - 2)}┐`);
  lines.push(`│ ${pad(title, inner)} │`);

  if (!view.session) {
    lines.push(`├${"─".repeat(w - 2)}┤`);
    lines.push(`│ ${pad(`${ANSI.yellow}No active session${ANSI.reset}`, inner + 9)} │`);
    lines.push(`│ ${pad(`${ANSI.dim}Type a goal at relay › below, or: session start <goal>${ANSI.reset}`, inner + 9)} │`);
    lines.push(`├${"─".repeat(w - 2)}┤`);
    lines.push(`│ ${pad(`${ANSI.dim}${DASH_INPUT_HINT}${ANSI.reset}`, inner + 9)} │`);
    lines.push(`└${"─".repeat(w - 2)}┘`);
    lines.push(renderBottomBar(w, null));
    if (view.message) {
      const tone =
        view.messageTone === "error" ? ANSI.yellow : view.messageTone === "hint" ? ANSI.cyan : ANSI.green;
      lines.push(`${tone}${view.message}${ANSI.reset}`);
    }
    return lines.join("\n");
  }

  const s = view.session;
  const active = latestHarness(view.hops, s.activeHarness);
  const goal = s.goal.length > inner - 12 ? `${s.goal.slice(0, inner - 15)}…` : s.goal;

  lines.push(`├${"─".repeat(w - 2)}┤`);
  lines.push(`│ ${pad(`${ANSI.bold}Goal${ANSI.reset}  ${goal}`, inner + 8)} │`);
  lines.push(
    `│ ${pad(
      `${ANSI.dim}Session${ANSI.reset} ${s.sessionId.slice(0, 8)}…  ${ANSI.dim}handoff${ANSI.reset} #${s.handoffSeq}  ${ANSI.dim}status${ANSI.reset} ${s.status}`,
      inner + 20,
    )} │`,
  );

  if (active) {
    const colored = `${harnessColor(active)}${ANSI.bold}${harnessLabel(active)}${ANSI.reset}`;
    lines.push(`│ ${pad(`${ANSI.bold}Active agent${ANSI.reset}  ${colored}`, inner + 16)} │`);
  }

  lines.push(`├${"─".repeat(w - 2)}┤`);
  lines.push(`│ ${pad(`${ANSI.bold}Run plan${ANSI.reset}`, inner + 8)} │`);

  if (!view.runState || view.runState.steps.length === 0) {
    lines.push(`│ ${pad(`${ANSI.dim}No plan yet — type your goal at relay ›${ANSI.reset}`, inner + 9)} │`);
  } else {
    for (const [index, step] of view.runState.steps.entries()) {
      const marker = index === view.runState.currentStepIndex ? "►" : " ";
      const statusColor =
        step.status === "done"
          ? ANSI.green
          : step.status === "failed"
            ? ANSI.yellow
            : step.status === "manual" || step.status === "running"
              ? ANSI.cyan
              : ANSI.dim;
      const row = `${marker} ${harnessColor(step.harness)}${harnessLabel(step.harness)}${ANSI.reset} ${step.task.slice(0, inner - 20)} ${statusColor}${step.status}${ANSI.reset}`;
      lines.push(`│ ${pad(row, inner + 20)} │`);
    }
  }

  lines.push(`├${"─".repeat(w - 2)}┤`);
  lines.push(`│ ${pad(`${ANSI.bold}Recent handoffs${ANSI.reset}`, inner + 8)} │`);

  const hopLines = view.hops.slice(-3);
  if (hopLines.length === 0) {
    lines.push(`│ ${pad(`${ANSI.dim}No events yet${ANSI.reset}`, inner + 9)} │`);
  } else {
    for (const hop of hopLines) {
      const time = formatTime(hop.at);
      let detail = hop.label;
      if (hop.kind === "handoff" && hop.to) {
        detail = `${harnessLabel(hop.from)} ${ANSI.dim}──►${ANSI.reset} ${harnessColor(hop.to as string)}${harnessLabel(hop.to)}${ANSI.reset}`;
      } else if (hop.kind === "start" && hop.to) {
        detail = `${ANSI.dim}started on${ANSI.reset} ${harnessColor(hop.to as string)}${harnessLabel(hop.to)}${ANSI.reset}`;
      }
      const row = `${ANSI.gray}${time}${ANSI.reset}  ${detail}`;
      lines.push(`│ ${pad(row, inner + 15)} │`);
    }
  }

  lines.push(`├${"─".repeat(w - 2)}┤`);
  const help = `${ANSI.dim}${DASH_INPUT_HINT}${ANSI.reset}`;
  lines.push(`│ ${pad(help, inner + 9)} │`);
  lines.push(`└${"─".repeat(w - 2)}┘`);

  if (view.message) {
    const tone =
      view.messageTone === "error" ? ANSI.yellow : view.messageTone === "hint" ? ANSI.cyan : ANSI.green;
    lines.push(`${tone}${view.message}${ANSI.reset}`);
  }

  lines.push(renderBottomBar(w, view.session));
  return lines.join("\n");
}

function renderBottomBar(width: number, session: RhpV1 | null): string {
  const w = Math.max(60, Math.min(width, 120));
  if (!session) {
    return `${ANSI.bgGray}${ANSI.bold} RELAY ${ANSI.reset}${ANSI.bgGray} no active task ${" ".repeat(Math.max(0, w - 28))}${ANSI.reset}`;
  }

  const goal = session.goal.length > 28 ? `${session.goal.slice(0, 25)}…` : session.goal;
  const agent = session.activeHarness ?? "—";
  const agentStyled = `${harnessColor(agent)}${harnessLabel(agent)}${ANSI.reset}`;
  const left = `${ANSI.bgBlue}${ANSI.bold}${ANSI.white} RELAY ${ANSI.reset}`;
  const mid = ` ${ANSI.bold}"${goal}"${ANSI.reset} ${ANSI.dim}──handoff──►${ANSI.reset} `;
  const right = `${agentStyled}${ANSI.dim} │ #${session.handoffSeq}${ANSI.reset}`;
  const plainLen = 6 + goal.length + 14 + harnessLabel(agent).length + 6;
  const padLen = Math.max(0, w - plainLen);
  return `${left}${mid}${right}${" ".repeat(padLen)}`;
}
