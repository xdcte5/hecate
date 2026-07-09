import { Command } from "commander";
import { HarnessIdSchema, type HarnessId } from "@relay/schema";
import { availableHarnesses, buildProject } from "@relay/adapters";

const HARNESS_ALIASES: Record<string, HarnessId> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
  cursor: "cursor",
  pi: "pi",
};

function parseHarness(value: string): HarnessId {
  const aliased = HARNESS_ALIASES[value];
  const parsed = HarnessIdSchema.safeParse(aliased ?? value);
  if (!parsed.success) {
    throw new Error(`Invalid harness: ${value}. Expected one of ${HarnessIdSchema.options.join(", ")}`);
  }
  return parsed.data;
}

export function registerBuildCommands(program: Command, getCwd: () => string): void {
  program
    .command("build")
    .description("Transpile relay/ into native harness layouts")
    .option("--harness <id>", "Build a single harness")
    .option("--all", "Build all available harnesses (default)")
    .action(async (options: { harness?: string; all?: boolean }) => {
      const cwd = getCwd();

      let harnesses: HarnessId[] | undefined;
      if (options.harness) {
        const harness = parseHarness(options.harness);
        if (!availableHarnesses().includes(harness)) {
          console.error(`No adapter available yet for: ${harness}`);
          process.exitCode = 1;
          return;
        }
        harnesses = [harness];
      }

      const result = await buildProject(cwd, { harnesses });

      for (const [harness, files] of Object.entries(result.filesByHarness)) {
        console.log(`${harness}: ${files.length} file(s)`);
      }
      console.log(`Wrote ${result.totalFiles} file(s) across ${result.lock.adapters.length} harness(es) + relay.lock`);
    });
}
