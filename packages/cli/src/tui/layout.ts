import { loadRelayTheme } from "./theme.js";

const theme = loadRelayTheme();
const A = theme.ansi;

export type LayoutRegions = {
  headerRows: number;
  transcriptRows: number;
  footerRows: number;
  inputRows: number;
};

export type LayoutState = {
  goal?: string;
  transcriptLines: string[];
  footerLine: string;
  inputPrompt: string;
  statusLine?: string;
  scrollOffset: number;
  width: number;
  height: number;
};

export function computeLayoutRegions(rows: number): LayoutRegions {
  const headerRows = 4;
  const footerRows = 1;
  const inputRows = 1;
  const separators = 2;
  const transcriptRows = Math.max(1, rows - headerRows - footerRows - inputRows - separators);
  return { headerRows, transcriptRows, footerRows, inputRows };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(text: string, width: number): string {
  const plain = stripAnsi(text);
  if (plain.length <= width) return text.padEnd(width + (text.length - plain.length));
  const slice = plain.slice(0, Math.max(0, width - 1)) + "…";
  return slice;
}

function padLine(text: string, width: number): string {
  const plain = stripAnsi(text);
  const pad = Math.max(0, width - plain.length);
  return text + " ".repeat(pad);
}

function horizontalRule(width: number, char = "─"): string {
  return `${A.dim}${char.repeat(Math.max(0, width))}${A.reset}`;
}

export function renderHeader(goal: string | undefined, width: number): string[] {
  const inner = Math.max(0, width - 2);
  const title = `${A.bold}${A.cyan}RELAY${A.reset} ${A.dim}· personal dev agent mesh${A.reset}`;
  const goalText = goal
    ? `${A.dim}goal:${A.reset} ${A.bold}${truncate(goal, inner - 12)}${A.reset}`
    : `${A.dim}type what you want to build${A.reset}`;

  return [
    `${A.dim}┌${A.reset}${horizontalRule(inner, "─")}${A.dim}┐${A.reset}`,
    `${A.dim}│${A.reset} ${padLine(title, inner)} ${A.dim}│${A.reset}`,
    `${A.dim}│${A.reset} ${padLine(goalText, inner)} ${A.dim}│${A.reset}`,
    `${A.dim}├${A.reset}${horizontalRule(inner, "─")}${A.dim}┤${A.reset}`,
  ];
}

export function visibleTranscriptSlice(
  lines: string[],
  transcriptRows: number,
  scrollOffset: number,
): { visible: string[]; scrollOffset: number } {
  const maxOffset = Math.max(0, lines.length - transcriptRows);
  const offset = Math.min(scrollOffset, maxOffset);
  const start = Math.max(0, lines.length - transcriptRows - offset);
  const visible = lines.slice(start, start + transcriptRows);
  while (visible.length < transcriptRows) visible.unshift("");
  return { visible, scrollOffset: offset };
}

export function renderTranscriptRegion(
  lines: string[],
  transcriptRows: number,
  scrollOffset: number,
  width: number,
): { lines: string[]; scrollOffset: number } {
  const inner = Math.max(0, width - 2);
  const { visible, scrollOffset: nextOffset } = visibleTranscriptSlice(
    lines,
    transcriptRows,
    scrollOffset,
  );
  const rendered = visible.map(
    (line) => `${A.dim}│${A.reset} ${padLine(truncate(line, inner), inner)} ${A.dim}│${A.reset}`,
  );
  return { lines: rendered, scrollOffset: nextOffset };
}

export function renderLayout(state: LayoutState): string {
  const width = Math.max(60, Math.min(state.width, 120));
  const regions = computeLayoutRegions(state.height);
  const parts: string[] = [];

  parts.push(...renderHeader(state.goal, width));

  const transcript = renderTranscriptRegion(
    state.transcriptLines,
    regions.transcriptRows,
    state.scrollOffset,
    width,
  );

  parts.push(...transcript.lines);
  parts.push(`${A.dim}├${A.reset}${horizontalRule(width - 2, "─")}${A.dim}┤${A.reset}`);

  const inner = Math.max(0, width - 2);
  parts.push(`${A.dim}│${A.reset} ${padLine(state.footerLine, inner)} ${A.dim}│${A.reset}`);
  parts.push(`${A.dim}├${A.reset}${horizontalRule(width - 2, "─")}${A.dim}┤${A.reset}`);
  parts.push(
    `${A.dim}│${A.reset} ${padLine(`${state.inputPrompt}`, inner)} ${A.dim}│${A.reset}`,
  );

  if (state.statusLine) {
    parts.push(state.statusLine);
  }

  return parts.join("\n");
}

/** Auto-scroll: pin to bottom unless user scrolled up. */
export function autoScrollOffset(
  lineCount: number,
  transcriptRows: number,
  currentOffset: number,
  stickToBottom: boolean,
): number {
  if (stickToBottom) return 0;
  return Math.min(currentOffset, Math.max(0, lineCount - transcriptRows));
}
