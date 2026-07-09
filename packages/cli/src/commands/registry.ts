import { Command } from "commander";
import type { HarnessId } from "@relay/schema";
import { loadRegistry } from "@relay/registry";

export function registerRegistryCommands(program: Command, getCwd: () => string): void {
  const registry = program.command("registry").description("Harness card registry");

  registry
    .command("list")
    .description("List registered harnesses")
    .action(async () => {
      const config = await loadRegistry(getCwd());
      for (const card of config.harnesses) {
        const strengths = card.strengths.join(", ");
        const binary = card.binaries[0] ?? "";
        console.log(`${card.id}\t${binary}\t${strengths}`);
      }
    });

  registry
    .command("show")
    .description("Show one harness card")
    .argument("<harness>", "Harness id")
    .action(async (harness: string) => {
      const config = await loadRegistry(getCwd());
      const card = config.harnesses.find((c) => c.id === harness);
      if (!card) {
        console.error(`Unknown harness: ${harness}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(card, null, 2));
    });
}
