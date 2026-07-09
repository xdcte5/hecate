import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runOrchestration, loadRunState } from "@relay/orchestrator";
import { SessionStore, readEvents } from "@relay/session";
import { parseHandoffHops } from "./hops.js";
import { formatRelayError, parseInputCommand } from "./input.js";
import { renderDashboard } from "./render.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../index.js");
const PROMPT = "\x1b[36mrelay\x1b[0m \x1b[1m›\x1b[0m ";

type DashOptions = {
  cwd: string;
};

export { parseInputCommand } from "./input.js";

export async function runDash(options: DashOptions): Promise<void> {
  const { cwd } = options;
  let message: string | undefined;
  let messageTone: "ok" | "hint" | "error" = "ok";
  let running = true;

  const loadView = async () => {
    const store = new SessionStore({ rootDir: cwd });
    const session = await store.getActive();
    const hops = session ? parseHandoffHops(await readEvents(cwd, session.sessionId)) : [];
    const runState = session ? await loadRunState(cwd, session.sessionId) : null;
    return {
      session,
      hops,
      runState,
      projectName: basename(cwd),
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24,
      message,
      messageTone,
    };
  };

  const paintView = async () => {
    const view = await loadView();
    paint(renderDashboard(view));
  };

  function runRelay(args: string[]): string {
    try {
      const out = execFileSync("node", [CLI, ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (args[0] === "handoff") {
        return formatHandoffResult(out.trim());
      }
      if (args[0] === "run") {
        return out.trim();
      }
      return out.trim().split("\n").slice(-3).join(" · ");
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string; message?: string };
      const raw = (err.stderr || err.stdout || err.message || "command failed").trim();
      messageTone = "error";
      return formatRelayError(raw);
    }
  }

  async function handleLine(line: string): Promise<void> {
    messageTone = "ok";
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed === "quit" || trimmed === "exit" || trimmed === "q") {
      running = false;
      return;
    }

    if (trimmed === "refresh") {
      message = "Refreshed.";
      messageTone = "hint";
      return;
    }

    const parsed = parseInputCommand(trimmed);

    if (!parsed) return;

    if (parsed.kind === "hint") {
      message = parsed.message;
      messageTone = "hint";
    } else if (parsed.kind === "run") {
      const result = await runOrchestration({
        cwd,
        goal: parsed.goal,
        mode: parsed.launch ? "launch" : "dry-run",
        interactive: Boolean(parsed.launch),
      });
      message = result.message;
      messageTone = "ok";
    } else {
      message = runRelay(parsed.args);
    }
  }

  await paintView();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: PROMPT,
  });

  const cleanup = () => {
    rl.close();
    process.stdout.write("\x1b[?25h");
  };

  rl.on("SIGINT", () => {
    running = false;
    cleanup();
    process.stdout.write("\n");
    process.exit(0);
  });

  rl.on("close", () => {
    running = false;
  });

  rl.on("line", (line) => {
    void (async () => {
      await handleLine(line);
      if (!running) {
        cleanup();
        return;
      }
      await paintView();
      rl.prompt();
    })();
  });

  rl.prompt();

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  cleanup();
}

function paint(text: string): void {
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
  process.stdout.write(text);
  process.stdout.write("\n");
}

function formatHandoffResult(output: string): string {
  const target = output.match(/Handoff prepared for: (\S+)/)?.[1] ?? "next agent";
  const seq = output.match(/Handoff #(\d+)/)?.[1];
  const rotated = output.includes("rotated to");
  const clipboard = output.includes("Clipboard: short prompt copied");

  const parts = [
    `Prepared handoff #${seq ?? "?"} → ${target}.`,
    rotated ? "Skipped same-agent loop." : null,
    clipboard
      ? "Prompt copied — paste into the next agent to continue."
      : "Open the next agent and read HANDOFF.md.",
  ].filter(Boolean);

  return parts.join(" ");
}
