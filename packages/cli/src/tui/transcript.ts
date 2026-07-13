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

  if (/^tool\s+[▶✓✗]/i.test(trimmed) || /^\s*│\s*tool/i.test(trimmed)) {
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
  info: `${ANSI.dim}hecate${ANSI.reset}`,
};

export function formatTranscriptEntry(entry: TranscriptEntry): string {
  const prefix = PREFIX[entry.kind];
  const body =
    entry.kind === "tool" && !entry.text.startsWith("tool")
      ? entry.text.replace(/^\s*│\s*/, "")
      : entry.text;
  return `${prefix} ${ANSI.bold}›${ANSI.reset} ${body}`;
}

export function parseOrchestratorLine(line: string): TranscriptEntry {
  const kind = classifyLine(line);
  return { kind, text: line.trim(), raw: line };
}

/** Pixel-block letters for the launch banner, one glyph per key, 5 rows tall. */
const BANNER_GLYPHS: Record<string, string[]> = {
  H: ["█  █", "█  █", "████", "█  █", "█  █"],
  E: ["████", "█   ", "███ ", "█   ", "████"],
  C: ["████", "█   ", "█   ", "█   ", "████"],
  A: ["████", "█  █", "████", "█  █", "█  █"],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
};

/** Render "HECATE" as a pixelated block banner. */
export function formatHecateBanner(goal?: string): string {
  const letters = "HECATE".split("").map((ch) => BANNER_GLYPHS[ch]!);
  const rows: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    const line = letters.map((glyph) => glyph[row]).join("  ");
    rows.push(`${ANSI.bold}${ANSI.magenta}${line}${ANSI.reset}`);
  }

  const goalLine = goal
    ? `${ANSI.dim}goal${ANSI.reset} ${ANSI.bold}${goal.slice(0, 60)}${goal.length > 60 ? "…" : ""}${ANSI.reset}`
    : `${ANSI.dim}type what you want to build — Ctrl+C twice to quit${ANSI.reset}`;
  return (
    `${rows.join("\n")}\n\n` +
    `${ANSI.dim}· personal super-harness across your agent subscriptions${ANSI.reset}\n` +
    `${goalLine}\n` +
    `${ANSI.dim}commands: status · agents · models · config${ANSI.reset}`
  );
}
