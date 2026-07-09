import { watch } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { buildProject, type BuildContext } from "@relay/adapters";
import { getHandoffPath, SessionStore } from "@relay/session";

async function resolveBuildContext(cwd: string): Promise<BuildContext> {
  const active = await new SessionStore({ rootDir: cwd }).getActive();
  return { handoffPointer: active ? getHandoffPath(active.sessionId) : null };
}

async function rebuild(cwd: string): Promise<void> {
  try {
    const context = await resolveBuildContext(cwd);
    const result = await buildProject(cwd, { context });
    const stamp = new Date().toLocaleTimeString();
    console.log(`[${stamp}] rebuilt ${result.totalFiles} file(s) across ${result.lock.adapters.length} harness(es)`);
  } catch (err) {
    console.error(`build failed: ${err instanceof Error ? err.message : err}`);
  }
}

export function registerWatchCommands(program: Command, getCwd: () => string): void {
  program
    .command("watch")
    .description("Rebuild harness outputs when relay/ changes")
    .option("--debounce <ms>", "Debounce window in milliseconds", "150")
    .action(async (options: { debounce: string }) => {
      const cwd = getCwd();
      const relayDir = join(cwd, "relay");
      const debounceMs = Number.parseInt(options.debounce, 10) || 150;

      await rebuild(cwd);
      console.log(`Watching ${relayDir} … (Ctrl+C to stop)`);

      let timer: NodeJS.Timeout | null = null;
      const schedule = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void rebuild(cwd), debounceMs);
      };

      try {
        const watcher = watch(relayDir, { recursive: true }, schedule);
        process.on("SIGINT", () => {
          watcher.close();
          process.exit(0);
        });
      } catch (err) {
        console.error(
          `Cannot watch ${relayDir}: ${err instanceof Error ? err.message : err}`,
        );
        process.exitCode = 1;
      }
    });
}
