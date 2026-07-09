import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { stringify as stringifyYaml } from "yaml";
import type { HarnessId } from "@relay/schema";
import { detectInstalledBinaries } from "@relay/adapters";

interface DefaultCard {
  id: HarnessId;
  strengths: string[];
  weaknesses: string[];
  binaries: string[];
}

const DEFAULT_CARDS: DefaultCard[] = [
  {
    id: "claude-code",
    strengths: ["architecture", "refactoring", "complex reasoning", "system design"],
    weaknesses: ["quick edits", "unit tests"],
    binaries: ["claude"],
  },
  {
    id: "codex",
    strengths: ["unit tests", "test generation", "api design", "typescript"],
    weaknesses: ["ui work", "frontend styling"],
    binaries: ["codex"],
  },
  {
    id: "cursor",
    strengths: ["react", "frontend", "component fixes", "jsx", "tsx"],
    weaknesses: ["long-running tasks", "deep architecture"],
    binaries: ["cursor-agent"],
  },
  {
    id: "pi",
    strengths: ["scripts", "automation", "cli", "lightweight tasks"],
    weaknesses: ["complex codebases", "multi-file refactors"],
    binaries: ["pi"],
  },
];

const DEFAULT_INSTRUCTIONS = `# Project instructions

Describe your project's conventions here. This file is the single source of
truth that Relay transpiles into every harness (CLAUDE.md, AGENTS.md, Cursor
rules, Pi overlay). Edit \`relay/\`, never the generated output.
`;

const DEFAULT_POLICY = {
  routing: [
    { pattern: "(?i)(unit test|write tests|vitest|jest)", harness: "codex", description: "Tests go to Codex" },
    { pattern: "(?i)(react|component|jsx|tsx|frontend)", harness: "cursor", description: "Frontend goes to Cursor" },
    { pattern: "(?i)(refactor|architecture|system design)", harness: "claude-code", description: "Architecture goes to Claude Code" },
    { pattern: "(?i)\\b(script|automation|cli|shell)\\b", harness: "pi", description: "Scripts go to Pi" },
  ],
  failover: ["cursor", "claude-code", "codex", "pi"],
  governance: { requireGitSnapshotOnHandoff: true, maxHandoffTokens: 8000, maxTranscriptLines: 200 },
};

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

      await mkdir(join(relayDir, "agents"), { recursive: true });
      await mkdir(join(relayDir, "skills"), { recursive: true });
      await mkdir(join(relayDir, "commands"), { recursive: true });

      await writeFile(join(relayDir, "relay.yaml"), 'version: "1"\n', "utf8");
      await writeFile(join(relayDir, "instructions.md"), DEFAULT_INSTRUCTIONS, "utf8");
      await writeFile(
        join(relayDir, "registry.yaml"),
        stringifyYaml({ harnesses: enabled }),
        "utf8",
      );
      await writeFile(join(relayDir, "session-policy.yaml"), stringifyYaml(DEFAULT_POLICY), "utf8");

      console.log(`Initialized relay/ with ${enabled.length} harness(es): ${enabled.map((c) => c.id).join(", ")}`);
      console.log("Next: edit relay/instructions.md, then `relay build --all`.");
    });
}
