import { Command } from "commander";
import { runOrchestration } from "@relay/orchestrator";

export function registerRunCommands(program: Command, getCwd: () => string): void {
  program
    .command("run")
    .description("Orchestrate a multi-agent run from a single prompt")
    .argument("[goal]", "What to build (e.g. add user login page)")
    .option("--launch", "Launch the active step in the matching harness CLI")
    .option("--clipboard", "Prepare handoff files without launching")
    .option("--next", "Advance to the next step (current step must be done)")
    .option("--complete", "Mark the current step as done")
    .option("--reset", "Reset the run plan for the goal")
    .option("--status", "Show the current run plan")
    .action(async (goal: string | undefined, options: {
      launch?: boolean;
      clipboard?: boolean;
      next?: boolean;
      complete?: boolean;
      reset?: boolean;
      status?: boolean;
    }) => {
      const mode = options.launch ? "launch" : options.clipboard ? "clipboard" : "dry-run";

      const result = await runOrchestration({
        cwd: getCwd(),
        goal: goal?.trim() || undefined,
        mode,
        interactive: Boolean(options.launch),
        advance: Boolean(options.next),
        complete: Boolean(options.complete),
        reset: Boolean(options.reset),
        statusOnly: Boolean(options.status),
      });

      console.log(result.message);
    });
}
