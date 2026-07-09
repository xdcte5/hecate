import readline from "node:readline";
import { getPromptStatus, processPrompt } from "@relay/orchestrator";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

type ChatOptions = {
  cwd: string;
};

export async function runChat(options: ChatOptions): Promise<void> {
  const { cwd } = options;

  console.log(
    `${ANSI.bold}${ANSI.cyan}Relay${ANSI.reset} — personal dev agent mesh\n` +
      `${ANSI.dim}Type what you want to build. Relay plans and runs agents automatically.${ANSI.reset}\n` +
      `${ANSI.dim}While running: type "status" for progress · Ctrl+C twice to cancel${ANSI.reset}\n`,
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: `${ANSI.dim}you${ANSI.reset} ${ANSI.bold}›${ANSI.reset} `,
  });

  let busy = false;
  let abortController: AbortController | null = null;
  let interruptCount = 0;
  let interruptTimer: ReturnType<typeof setTimeout> | null = null;

  const say = (text: string) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} ${text}\n`);
  };

  const showStatus = async () => {
    const rows = await getPromptStatus(cwd);
    for (const row of rows) say(row);
  };

  const cleanup = () => {
    abortController?.abort();
    rl.close();
    process.stdout.write(ANSI.reset);
  };

  const resetBusy = () => {
    busy = false;
    abortController = null;
    rl.resume();
    rl.prompt();
  };

  rl.on("SIGINT", () => {
    interruptCount += 1;
    if (interruptTimer) clearTimeout(interruptTimer);
    interruptTimer = setTimeout(() => {
      interruptCount = 0;
    }, 2000);

    if (busy && interruptCount === 1) {
      say(`${ANSI.yellow}Working… type "status" for progress, or Ctrl+C again to cancel${ANSI.reset}`);
      rl.prompt();
      return;
    }

    if (busy && interruptCount >= 2) {
      say("Cancelling…");
      abortController?.abort();
      resetBusy();
      interruptCount = 0;
      return;
    }

    console.log("\n");
    cleanup();
    process.exit(0);
  });

  rl.on("line", (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
        cleanup();
        return;
      }

      if (trimmed === "status" || trimmed === "progress" || trimmed === "what's happening") {
        await showStatus();
        rl.prompt();
        return;
      }

      if (busy) {
        say(`${ANSI.yellow}Still working — type "status" or press Ctrl+C twice to cancel${ANSI.reset}`);
        rl.prompt();
        return;
      }

      busy = true;
      abortController = new AbortController();
      rl.pause();

      try {
        const result = await processPrompt(cwd, trimmed, {
          signal: abortController.signal,
          onLine: (row) => say(row),
        });

        if (!result.ok && !abortController.signal.aborted) {
          say("Stopped — try again or rephrase your prompt.");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          say(error instanceof Error ? error.message : String(error));
        }
      } finally {
        console.log("");
        resetBusy();
      }
    })();
  });

  rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}
