import { runChat } from "./chat.js";

type DashOptions = {
  cwd: string;
};

export async function runDash(options: DashOptions): Promise<void> {
  process.stdout.write(
    "\x1b[33mrelay dash is deprecated\x1b[0m — use \x1b[36mrelay chat\x1b[0m instead.\n",
  );
  process.stdout.write("Plan panels and handoff hops are merging into the chat TUI.\n\n");
  await runChat({ cwd: options.cwd });
}
