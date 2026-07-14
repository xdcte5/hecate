import { Command } from "commander";
import { runDash } from "../tui/run-dash.js";

export function registerDashCommands(program: Command, getCwd: () => string): void {
  program
    .command("dash")
    .description("Deprecated — use `relay` chat mode (shows deprecation notice)")
    .action(async () => {
      await runDash({ cwd: getCwd() });
    });
}
