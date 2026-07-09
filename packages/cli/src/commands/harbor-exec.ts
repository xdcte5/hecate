import { Command } from "commander";
import { processPrompt } from "@relay/orchestrator";
import type { HarnessId } from "@relay/schema";

export function registerHarborExecCommands(program: Command, getCwd: () => string): void {
  program
    .command("harbor-exec")
    .description("Non-interactive orchestrated run (for Harbor Terminal-Bench)")
    .argument("<prompt>", "Task instruction from Harbor")
    .option(
      "--agents <ids>",
      "Comma-separated harness ids (default: claude-code,codex)",
      "claude-code,codex",
    )
    .action(async (prompt: string, options: { agents: string }) => {
      const cwd = getCwd();
      const enabledAgents = options.agents
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean) as HarnessId[];

      const result = await processPrompt(cwd, prompt, {
        enabledAgents,
        onLine: (line) => console.log(line),
      });

      for (const line of result.lines) {
        if (!result.ok) console.error(line);
      }

      process.exitCode = result.ok ? 0 : 1;
    });
}
