import type { HarnessId } from "@relay/schema";

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

const HARNESS_ALIASES: Record<string, HarnessId> = {
  pi: "pi",
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  cursor: "cursor",
};

export const BUSY_BLOCK_MESSAGE =
  "Finish or cancel the current step first — /steer, /status, /harness, /model, or Ctrl+C twice";

export const RELAY_COMMAND_HELP = [
  "Type your goal           → plan steps",
  "/steer <msg>             → steer while running",
  "/status                  → show plan",
  "/agents                  → pick enabled agents",
  "/harness <agent>         → next step: pi · claude-code · codex · cursor",
  "/model <name>            → next step model override",
  "launch                   → start current step",
  "done                     → mark step finished",
  "next                     → go to next step",
  "status                   → show plan",
  "reset                    → restart plan",
  "help · quit",
].join(" · ");

export type SlashCommand = "steer" | "status" | "agents";

export type ParsedInput =
  | { kind: "relay"; args: string[] }
  | { kind: "run"; goal: string; launch?: boolean }
  | { kind: "hint"; message: string }
  | { kind: "slash"; command: SlashCommand }
  | { kind: "steer"; message: string }
  | { kind: "tui"; command: "models" | "config" }
  | { kind: "harness"; harness: HarnessId }
  | { kind: "model"; model: string };

export type TuiInputAction =
  | { type: "noop" }
  | { type: "quit" }
  | { type: "status" }
  | { type: "agents" }
  | { type: "models" }
  | { type: "config" }
  | { type: "help" }
  | { type: "run"; goal: string }
  | { type: "steer"; message: string }
  | { type: "hint"; message: string }
  | { type: "harness"; harness: HarnessId }
  | { type: "model"; model: string }
  | { type: "busy-block"; message: string };

export type TuiInputContext = {
  busy: boolean;
};

function parseHarnessToken(raw: string): HarnessId | null {
  return HARNESS_ALIASES[raw.toLowerCase()] ?? null;
}

function parseSlashCommand(trimmed: string): ParsedInput | null {
  if (!trimmed.startsWith("/")) return null;

  const body = trimmed.slice(1);
  const space = body.indexOf(" ");
  const command = (space >= 0 ? body.slice(0, space) : body).toLowerCase();
  const args = space >= 0 ? body.slice(space + 1).trim() : "";

  switch (command) {
    case "steer":
      if (!args) return { kind: "hint", message: "Usage: /steer <message>" };
      return { kind: "steer", message: args };
    case "status":
      return { kind: "slash", command: "status" };
    case "agents":
      return { kind: "slash", command: "agents" };
    case "harness": {
      if (!args) {
        return { kind: "hint", message: "Usage: /harness <pi|claude-code|codex|cursor>" };
      }
      const harness = parseHarnessToken(args.split(/\s+/)[0]!);
      if (!harness) {
        return { kind: "hint", message: "Unknown harness — try pi, claude-code, codex, or cursor" };
      }
      return { kind: "harness", harness };
    }
    case "model":
      if (!args) return { kind: "hint", message: "Usage: /model <model-name>" };
      return { kind: "model", model: args };
    default:
      return {
        kind: "hint",
        message: `Unknown command /${command} — try /status, /agents, /harness, /model, /steer`,
      };
  }
}

export function parseInputCommand(line: string): ParsedInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const slash = parseSlashCommand(trimmed);
  if (slash) return slash;

  if (trimmed === "help" || trimmed === "?") {
    return { kind: "hint", message: RELAY_COMMAND_HELP };
  }

  if (trimmed === "agents") return { kind: "slash", command: "agents" };
  if (trimmed === "models") return { kind: "tui", command: "models" };
  if (trimmed === "config") return { kind: "tui", command: "config" };
  if (trimmed === "status" || trimmed === "progress") return { kind: "slash", command: "status" };

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

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0]!.toLowerCase();
  if (tokens.length === 1 && KNOWN_ROOT.has(first)) {
    return { kind: "relay", args: tokens };
  }

  return { kind: "run", goal: trimmed };
}

/** Map parsed input to TUI actions (steer while busy, run when idle). */
export function resolveTuiInput(line: string, context: TuiInputContext): TuiInputAction {
  const trimmed = line.trim();
  if (!trimmed) return { type: "noop" };

  if (trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
    return { type: "quit" };
  }

  const parsed = parseInputCommand(trimmed);
  if (!parsed) return { type: "noop" };

  switch (parsed.kind) {
    case "slash":
      if (parsed.command === "status") return { type: "status" };
      if (parsed.command === "agents") {
        return context.busy
          ? { type: "busy-block", message: BUSY_BLOCK_MESSAGE }
          : { type: "agents" };
      }
      break;
    case "tui":
      if (parsed.command === "models" || parsed.command === "config") {
        return context.busy
          ? { type: "busy-block", message: BUSY_BLOCK_MESSAGE }
          : { type: parsed.command };
      }
      break;
    case "harness":
      return { type: "harness", harness: parsed.harness };
    case "model":
      return { type: "model", model: parsed.model };
    case "steer":
      return { type: "steer", message: parsed.message };
    case "hint":
      return { type: "hint", message: parsed.message };
    case "run":
      if (context.busy) return { type: "steer", message: parsed.goal };
      return { type: "run", goal: parsed.goal };
    case "relay":
      if (parsed.args[0] === "run" && parsed.args[1] === "--status") {
        return { type: "status" };
      }
      if (context.busy) {
        return { type: "hint", message: "Still working — use /steer, /status, or Ctrl+C twice to cancel" };
      }
      return { type: "hint", message: `Relay command not available in chat: ${parsed.args.join(" ")}` };
  }

  if (trimmed === "help" || trimmed === "?") return { type: "help" };

  return { type: "noop" };
}

export function formatSteerAck(message: string): string {
  const preview = message.length > 72 ? `${message.slice(0, 69)}…` : message;
  return `Steer queued → ${preview}`;
}

export function formatHarnessOverrideAck(harness: HarnessId, busy: boolean): string {
  const when = busy ? "after current step" : "on next prompt";
  return `Harness override → ${harness} (${when})`;
}

export function formatModelOverrideAck(model: string, busy: boolean): string {
  const when = busy ? "after current step" : "on next prompt";
  return `Model override → ${model} (${when})`;
}

export function formatRelayError(stderr: string): string {
  const text = stderr.trim();
  if (/unknown command/i.test(text)) {
    return `${text.split("\n")[0]} — type help`;
  }
  return text;
}
