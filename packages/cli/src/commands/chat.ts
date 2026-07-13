import { Command } from "commander";
import { runChat } from "../tui/chat.js";

export function registerChatCommands(program: Command, getCwd: () => string): void {
  program
    .command("chat")
    .description("Chat with Hecate — type natural language, agents run automatically")
    .option("-p, --preserve", "keep session folders on quit instead of deleting them")
    .action(async (opts: { preserve?: boolean }) => {
      await runChat({ cwd: getCwd(), preserve: opts.preserve });
    });
}
