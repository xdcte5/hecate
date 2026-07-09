import { Command } from "commander";
import { runChat } from "../tui/chat.js";

export function registerChatCommands(program: Command, getCwd: () => string): void {
  program
    .command("chat")
    .description("Chat with Relay — type natural language, agents run automatically")
    .action(async () => {
      await runChat({ cwd: getCwd() });
    });
}
