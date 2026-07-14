/** Shared ANSI styling for transcript components (Pi-like, Relay-branded). */
export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
} as const;

export const PREFIX = {
  plan: `${ANSI.cyan}plan${ANSI.reset}`,
  tool: `${ANSI.magenta}tool${ANSI.reset}`,
  agent: `${ANSI.yellow}agent${ANSI.reset}`,
  error: `${ANSI.red}err${ANSI.reset}`,
  success: `${ANSI.green}ok${ANSI.reset}`,
  info: `${ANSI.dim}relay${ANSI.reset}`,
  bash: `${ANSI.magenta}bash${ANSI.reset}`,
} as const;

export function relayChevron(): string {
  return `${ANSI.bold}›${ANSI.reset}`;
}

export function indentBody(lines: string[], prefix = "       │  "): string[] {
  return lines.map((line) => `${prefix}${line}`);
}
