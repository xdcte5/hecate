import { execFileSync } from "node:child_process";
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
  contextPct?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  gitBranch?: string;
  cwd: string;
  goal?: string;
  width?: number;
};

/** Compact token count for footer (Pi-like: 12.4k, 1.2M). */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Compact USD cost for footer. */
export function formatCostUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export type UsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export function addUsageTotals(base: UsageSnapshot, add: UsageSnapshot): UsageSnapshot {
  const inputTokens = (base.inputTokens ?? 0) + (add.inputTokens ?? 0);
  const outputTokens = (base.outputTokens ?? 0) + (add.outputTokens ?? 0);
  const costUsd = (base.costUsd ?? 0) + (add.costUsd ?? 0);
  return {
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(costUsd > 0 ? { costUsd } : {}),
  };
}

/** Track cumulative session usage across multi-step plans. */
export function createUsageTracker() {
  let session: UsageSnapshot = {};
  let step: UsageSnapshot = {};

  return {
    resetSession(): void {
      session = {};
      step = {};
    },
    onStepStart(): void {
      step = {};
    },
    onUsage(event: UsageSnapshot): UsageSnapshot {
      if (event.inputTokens !== undefined) step.inputTokens = event.inputTokens;
      if (event.outputTokens !== undefined) step.outputTokens = event.outputTokens;
      if (event.costUsd !== undefined) step.costUsd = event.costUsd;
      return addUsageTotals(session, step);
    },
    onStepEnd(): UsageSnapshot {
      session = addUsageTotals(session, step);
      step = {};
      return session;
    },
    getDisplay(): UsageSnapshot {
      return addUsageTotals(session, step);
    },
  };
}

export function detectGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

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

  const ctxText =
    state.contextPct !== undefined
      ? `${ANSI.dim}ctx${ANSI.reset} ${state.contextPct}%`
      : null;

  const usageParts: string[] = [];
  if (state.inputTokens !== undefined) {
    usageParts.push(`${ANSI.dim}↑${ANSI.reset}${formatTokenCount(state.inputTokens)}`);
  }
  if (state.outputTokens !== undefined) {
    usageParts.push(`${ANSI.dim}↓${ANSI.reset}${formatTokenCount(state.outputTokens)}`);
  }
  if (state.costUsd !== undefined) {
    usageParts.push(`${ANSI.green}${formatCostUsd(state.costUsd)}${ANSI.reset}`);
  }
  const usageText = usageParts.length > 0 ? usageParts.join(" ") : null;

  const cwd = basename(state.cwd);
  const branch = state.gitBranch;
  const pathText = branch
    ? `${ANSI.gray}${branch}${ANSI.dim}:${ANSI.reset}${ANSI.gray}${cwd}${ANSI.reset}`
    : `${ANSI.gray}${cwd}${ANSI.reset}`;

  const left = `${ANSI.bgBlue}${ANSI.bold}${ANSI.white} relay ${ANSI.reset}`;
  const segments = [
    `${ANSI.dim}harness${ANSI.reset} ${harnessStyled}`,
    `${ANSI.dim}model${ANSI.reset} ${model}`,
    stepText,
    ...(ctxText ? [ctxText] : []),
    ...(usageText ? [usageText] : []),
    `${ANSI.dim}cwd${ANSI.reset} ${pathText}`,
  ];
  const body = segments.join(` ${ANSI.dim}·${ANSI.reset} `);
  const plainLen =
    7 +
    (harness ? harnessText.length : 1) +
    (state.modelMode === "auto" || !state.model ? 4 : (state.model?.length ?? 4)) +
    (state.step !== undefined ? 8 : 4) +
    (state.contextPct !== undefined ? 8 : 0) +
    (state.inputTokens !== undefined ? formatTokenCount(state.inputTokens).length + 1 : 0) +
    (state.outputTokens !== undefined ? formatTokenCount(state.outputTokens).length + 1 : 0) +
    (state.costUsd !== undefined ? formatCostUsd(state.costUsd).length : 0) +
    cwd.length +
    (branch ? branch.length + 1 : 0) +
    24;
  const padLen = Math.max(0, w - plainLen);
  return `${left} ${body}${" ".repeat(padLen)}`;
}
