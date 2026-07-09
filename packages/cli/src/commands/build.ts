import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { HarnessIdSchema, type HarnessId } from "@relay/schema";
import { availableHarnesses, buildProject, type BuildContext } from "@relay/adapters";
import { getHandoffPath, SessionStore } from "@relay/session";

/** Resolve the active session's HANDOFF pointer for adapter inject, if any. */
async function resolveBuildContext(cwd: string): Promise<BuildContext> {
  const active = await new SessionStore({ rootDir: cwd }).getActive();
  return { handoffPointer: active ? getHandoffPath(active.sessionId) : null };
}

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
    .option("--pi-global", "Write Pi output to ~/.pi instead of the project (opt-in)")
    .action(async (options: { harness?: string; all?: boolean; piGlobal?: boolean }) => {
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

      const context = await resolveBuildContext(cwd);
      const piGlobalHome = options.piGlobal ? join(homedir(), ".pi") : undefined;
      const result = await buildProject(cwd, { harnesses, context, piGlobalHome });

      for (const [harness, files] of Object.entries(result.filesByHarness)) {
        const dest = harness === "pi" && piGlobalHome ? ` → ${piGlobalHome}` : "";
        console.log(`${harness}: ${files.length} file(s)${dest}`);
      }
      if (context.handoffPointer) {
        console.log(`Injected active session: ${context.handoffPointer}`);
      }
      console.log(`Wrote ${result.totalFiles} file(s) across ${result.lock.adapters.length} tracked harness(es) + relay.lock`);
    });
}
