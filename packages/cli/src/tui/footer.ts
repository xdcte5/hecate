import { basename } from "node:path";
import type { HarnessId } from "@relay/schema";
import type { ModelMode } from "./local-config.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
  white: "\x1b[97m",
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "gemini-cli": "Gemini",
};

function harnessColor(id: HarnessId | undefined): string {
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
      return ANSI.gray;
  }
}

export type FooterState = {
  harness?: HarnessId;
  model?: string;
  modelMode?: ModelMode;
  step?: number;
  totalSteps?: number;
  cwd: string;
  goal?: string;
  width?: number;
};

export function renderFooter(state: FooterState): string {
  const w = Math.max(60, Math.min(state.width ?? process.stdout.columns ?? 80, 120));
  const harness = state.harness;
  const harnessText = harness ? HARNESS_LABEL[harness] : "—";
  const harnessStyled = harness
    ? `${harnessColor(harness)}${harnessText}${ANSI.reset}`
    : `${ANSI.dim}—${ANSI.reset}`;

  const model =
    state.modelMode === "auto" || !state.model
      ? `${ANSI.dim}auto${ANSI.reset}`
      : `${ANSI.cyan}${state.model}${ANSI.reset}`;

  const stepText =
    state.step !== undefined && state.totalSteps !== undefined
      ? `${ANSI.dim}step${ANSI.reset} ${state.step}/${state.totalSteps}`
      : `${ANSI.dim}idle${ANSI.reset}`;

  const cwd = basename(state.cwd);
  const left = `${ANSI.bgBlue}${ANSI.bold}${ANSI.white} relay ${ANSI.reset}`;
  const segments = [
    `${ANSI.dim}harness${ANSI.reset} ${harnessStyled}`,
    `${ANSI.dim}model${ANSI.reset} ${model}`,
    stepText,
    `${ANSI.dim}cwd${ANSI.reset} ${ANSI.gray}${cwd}${ANSI.reset}`,
  ];
  const body = segments.join(` ${ANSI.dim}·${ANSI.reset} `);
  const plainLen =
    7 +
    (harness ? harnessText.length : 1) +
    (state.modelMode === "auto" || !state.model ? 4 : (state.model?.length ?? 4)) +
    (state.step !== undefined ? 8 : 4) +
    cwd.length +
    20;
  const padLen = Math.max(0, w - plainLen);
  return `${left} ${body}${" ".repeat(padLen)}`;
}
