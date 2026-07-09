import { Command } from "commander";
import { runDash } from "../tui/run-dash.js";

export function registerDashCommands(program: Command, getCwd: () => string): void {
  program
    .command("dash")
    .description("Interactive mesh dashboard with handoff status bar")
    .action(async () => {
      await runDash({ cwd: getCwd() });
    });
}
