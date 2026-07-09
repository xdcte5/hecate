import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { detectInstalledBinaries } from "@relay/adapters";
import { DEFAULT_CARDS, type DefaultCard, writeBaseScaffold } from "../scaffold.js";

export function registerInitCommands(program: Command, getCwd: () => string): void {
  program
    .command("init")
    .description("Scaffold relay/ and enable detected harnesses")
    .option("--force", "Overwrite an existing relay/ directory")
    .option("--all-harnesses", "Enable all harnesses regardless of detection")
    .action(async (options: { force?: boolean; allHarnesses?: boolean }) => {
      const cwd = getCwd();
      const relayDir = join(cwd, "relay");

      if (existsSync(relayDir) && !options.force) {
        console.error("relay/ already exists. Use --force to overwrite.");
        process.exitCode = 1;
        return;
      }

      // Detect which harnesses are actually installed.
      const detected: DefaultCard[] = [];
      for (const card of DEFAULT_CARDS) {
        const found = await detectInstalledBinaries(card.binaries);
        if (found.length > 0) detected.push(card);
      }

      let enabled = detected;
      if (options.allHarnesses || detected.length === 0) {
        if (detected.length === 0) {
          console.warn("No harness binaries detected on PATH — enabling all 4 (edit relay/registry.yaml to trim).");
        }
        enabled = DEFAULT_CARDS;
      }

      await writeBaseScaffold(relayDir, enabled, { overwrite: true });

      console.log(`Initialized relay/ with ${enabled.length} harness(es): ${enabled.map((c) => c.id).join(", ")}`);
      console.log("Next: edit relay/instructions.md, then `relay build --all`.");
    });
}
