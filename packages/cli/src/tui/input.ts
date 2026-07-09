const KNOWN_ROOT = new Set([
  "session",
  "handoff",
  "build",
  "trace",
  "doctor",
  "init",
  "watch",
  "mcp",
  "migrate",
  "registry",
  "dash",
  "run",
  "help",
]);

export const RELAY_COMMAND_HELP = [
  "Type your goal           → plan steps",
  "launch                   → start current step",
  "done                     → mark step finished",
  "next                     → go to next step",
  "status                   → show plan",
  "reset                    → restart plan",
  "help · quit",
].join(" · ");

export type ParsedInput =
  | { kind: "relay"; args: string[] }
  | { kind: "run"; goal: string; launch?: boolean }
  | { kind: "hint"; message: string };

export function parseInputCommand(line: string): ParsedInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed === "help" || trimmed === "?") {
    return { kind: "hint", message: RELAY_COMMAND_HELP };
  }

  if (trimmed === "build" || trimmed === "b") {
    return { kind: "relay", args: ["build", "--all"] };
  }

  if (trimmed === "handoff" || trimmed === "h") {
    return { kind: "relay", args: ["handoff", "--to", "auto"] };
  }

  if (trimmed === "trace") {
    return { kind: "relay", args: ["trace"] };
  }

  if (trimmed === "doctor") {
    return { kind: "relay", args: ["doctor", "--session"] };
  }

  if (trimmed === "launch") {
    return { kind: "relay", args: ["run", "--launch"] };
  }

  if (trimmed === "done" || trimmed === "complete") {
    return { kind: "relay", args: ["run", "--complete"] };
  }

  if (trimmed === "next" || trimmed === "n") {
    return { kind: "relay", args: ["run", "--next"] };
  }

  if (trimmed === "status") {
    return { kind: "relay", args: ["run", "--status"] };
  }

  if (trimmed === "reset") {
    return { kind: "hint", message: 'Type: reset <goal>  e.g. reset add user login page' };
  }

  if (trimmed.startsWith("reset ")) {
    const goal = trimmed.slice("reset ".length).trim();
    if (goal) return { kind: "relay", args: ["run", goal, "--reset"] };
  }

  if (trimmed.startsWith("handoff ")) {
    const target = trimmed.slice("handoff ".length).trim();
    const harness =
      target === "claude"
        ? "claude-code"
        : target === "auto" ||
            target === "codex" ||
            target === "cursor" ||
            target === "pi" ||
            target === "claude-code"
          ? target
          : null;
    if (harness) return { kind: "relay", args: ["handoff", "--to", harness] };
  }

  if (trimmed.startsWith("session start ")) {
    const goal = trimmed.slice("session start ".length).trim();
    if (goal) return { kind: "run", goal };
  }

  if (trimmed === "run --launch" || trimmed === "run launch") {
    return { kind: "relay", args: ["run", "--launch"] };
  }

  if (trimmed.startsWith("run ")) {
    const rest = trimmed.slice("run ".length).trim();
    if (rest === "--launch" || rest === "launch") {
      return { kind: "relay", args: ["run", "--launch"] };
    }
    if (rest) return { kind: "run", goal: rest };
  }

  const first = trimmed.split(/\s+/)[0]!.toLowerCase();
  if (KNOWN_ROOT.has(first)) {
    return { kind: "relay", args: trimmed.split(/\s+/) };
  }

  return { kind: "run", goal: trimmed };
}

export function formatRelayError(stderr: string): string {
  const text = stderr.trim();
  if (/unknown command/i.test(text)) {
    return `${text.split("\n")[0]} — type help`;
  }
  return text;
}
