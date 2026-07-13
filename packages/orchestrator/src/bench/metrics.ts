import type {
  AggregateMetrics,
  BenchReport,
  BenchSavings,
  RunMetrics,
  TaskComparison,
} from "./types.js";

/** Rough token estimate from output volume (~4 chars/token) when real usage isn't reported. */
export function estimateTokens(outputChars: number, reportedTokens?: number): number {
  if (typeof reportedTokens === "number" && reportedTokens > 0) return reportedTokens;
  return Math.round(outputChars / 4);
}

/** Best-effort scrape of a real token count from agent output lines. */
export function parseReportedTokens(lines: string[]): number | undefined {
  let total = 0;
  let found = false;
  const patterns = [
    /"(?:total_tokens|output_tokens|tokens)"\s*:\s*(\d+)/gi,
    /\b(\d+)\s*tokens\b/gi,
    /\btokens\s*[:=]\s*(\d+)/gi,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        total += Number.parseInt(m[1]!, 10);
        found = true;
      }
    }
  }
  return found ? total : undefined;
}

export function estimateCost(tokens: number, costPer1kTokens?: Record<string, number>): number | undefined {
  const rate = costPer1kTokens?.default;
  if (typeof rate !== "number") return undefined;
  return (tokens / 1000) * rate;
}

/** Percent reduction from baseline → hecate (positive = improvement). */
export function pctReduction(baseline: number, hecate: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((baseline - hecate) / baseline) * 1000) / 10;
}

export function computeSavings(baseline: RunMetrics, hecate: RunMetrics): BenchSavings {
  return {
    wallPct: pctReduction(baseline.wallMs, hecate.wallMs),
    tokenPct: pctReduction(baseline.estimatedTokens, hecate.estimatedTokens),
    invocationsDelta: hecate.agentInvocations - baseline.agentInvocations,
  };
}

export function aggregate(runs: RunMetrics[]): AggregateMetrics {
  const costs = runs.map((r) => r.estimatedCostUsd).filter((c): c is number => typeof c === "number");
  return {
    runs: runs.length,
    okRuns: runs.filter((r) => r.ok).length,
    wallMs: sum(runs.map((r) => r.wallMs)),
    agentInvocations: sum(runs.map((r) => r.agentInvocations)),
    estimatedTokens: sum(runs.map((r) => r.estimatedTokens)),
    estimatedCostUsd: costs.length > 0 ? round(sum(costs), 4) : undefined,
    filesChanged: sum(runs.map((r) => r.filesChanged)),
    verifyPassed: runs.filter((r) => r.verifyPassed === true).length,
  };
}

export function buildReport(comparisons: TaskComparison[]): BenchReport {
  const baselineRuns = comparisons.map((c) => c.baseline);
  const hecateRuns = comparisons.map((c) => c.hecate);
  const baseline = aggregate(baselineRuns);
  const hecate = aggregate(hecateRuns);
  return {
    createdAt: new Date().toISOString(),
    tasks: comparisons,
    totals: {
      baseline,
      hecate,
      savings: {
        wallPct: pctReduction(baseline.wallMs, hecate.wallMs),
        tokenPct: pctReduction(baseline.estimatedTokens, hecate.estimatedTokens),
        invocationsDelta: hecate.agentInvocations - baseline.agentInvocations,
      },
    },
  };
}

/** Human-readable comparison table for the terminal. */
export function formatReportTable(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("Hecate benchmark — single-agent baseline vs multi-agent Hecate");
  lines.push("");
  lines.push(pad("task", 22) + pad("mode", 10) + pad("ok", 4) + rpad("wall(s)", 9) + rpad("calls", 7) + rpad("~tokens", 10) + rpad("files", 7) + "verify");
  lines.push("─".repeat(78));
  for (const t of report.tasks) {
    lines.push(row(t.taskId, t.baseline));
    lines.push(row("", t.hecate));
    lines.push(
      `${pad("", 22)}${pad("Δ", 10)}${pad("", 4)}${rpad(signed(t.savings.wallPct, "%"), 9)}${rpad(signedNum(t.savings.invocationsDelta), 7)}${rpad(signed(t.savings.tokenPct, "%"), 10)}`,
    );
    lines.push("");
  }
  const b = report.totals.baseline;
  const h = report.totals.hecate;
  lines.push("─".repeat(78));
  lines.push(`TOTAL baseline: ${fmtSecs(b.wallMs)}s · ${b.agentInvocations} calls · ~${b.estimatedTokens} tok · ${b.filesChanged} files · ${b.verifyPassed}/${b.runs} verified`);
  lines.push(`TOTAL hecate:   ${fmtSecs(h.wallMs)}s · ${h.agentInvocations} calls · ~${h.estimatedTokens} tok · ${h.filesChanged} files · ${h.verifyPassed}/${h.runs} verified`);
  if (typeof b.estimatedCostUsd === "number" && typeof h.estimatedCostUsd === "number") {
    lines.push(`TOTAL cost:     baseline $${b.estimatedCostUsd} vs hecate $${h.estimatedCostUsd}`);
  }
  lines.push("");
  lines.push(
    `SAVINGS: wall ${signed(report.totals.savings.wallPct, "%")} · tokens ${signed(report.totals.savings.tokenPct, "%")} · calls ${signedNum(report.totals.savings.invocationsDelta)}`,
  );
  return lines.join("\n");
}

function row(taskId: string, m: RunMetrics): string {
  return (
    pad(taskId, 22) +
    pad(m.mode, 10) +
    pad(m.ok ? "✓" : "✗", 4) +
    rpad(fmtSecs(m.wallMs), 9) +
    rpad(String(m.agentInvocations), 7) +
    rpad(`~${m.estimatedTokens}`, 10) +
    rpad(String(m.filesChanged), 7) +
    (m.verifyPassed === undefined ? "—" : m.verifyPassed ? "pass" : "fail")
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const fmtSecs = (ms: number) => (ms / 1000).toFixed(1);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const rpad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const signed = (n: number, suffix = "") => `${n > 0 ? "+" : ""}${n}${suffix}`;
const signedNum = (n: number) => `${n > 0 ? "+" : ""}${n}`;
