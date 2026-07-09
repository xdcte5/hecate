import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { HarnessId } from "@relay/schema";

export interface DefaultCard {
  id: HarnessId;
  strengths: string[];
  weaknesses: string[];
  binaries: string[];
}

export const DEFAULT_CARDS: DefaultCard[] = [
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

export const DEFAULT_INSTRUCTIONS = `# Project instructions

Describe your project's conventions here. This file is the single source of
truth that Relay transpiles into every harness (CLAUDE.md, AGENTS.md, Cursor
rules, Pi overlay). Edit \`relay/\`, never the generated output.
`;

export const DEFAULT_POLICY = {
  routing: [
    { pattern: "(?i)(unit test|write tests|vitest|jest)", harness: "codex", description: "Tests go to Codex" },
    { pattern: "(?i)(react|component|jsx|tsx|frontend)", harness: "cursor", description: "Frontend goes to Cursor" },
    { pattern: "(?i)(refactor|architecture|system design)", harness: "claude-code", description: "Architecture goes to Claude Code" },
    { pattern: "(?i)\\b(script|automation|cli|shell)\\b", harness: "pi", description: "Scripts go to Pi" },
  ],
  failover: ["cursor", "claude-code", "codex", "pi"],
  governance: { requireGitSnapshotOnHandoff: true, maxHandoffTokens: 8000, maxTranscriptLines: 200 },
};

/** Create relay/ directories and any of the base config files not already present. */
export async function writeBaseScaffold(
  relayDir: string,
  cards: DefaultCard[],
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  await mkdir(join(relayDir, "agents"), { recursive: true });
  await mkdir(join(relayDir, "skills"), { recursive: true });
  await mkdir(join(relayDir, "commands"), { recursive: true });

  const write = async (name: string, content: string): Promise<void> => {
    const path = join(relayDir, name);
    if (!opts.overwrite && existsSync(path)) return;
    await writeFile(path, content, "utf8");
  };

  await write("relay.yaml", 'version: "1"\n');
  await write("instructions.md", DEFAULT_INSTRUCTIONS);
  await write("registry.yaml", stringifyYaml({ harnesses: cards }));
  await write("session-policy.yaml", stringifyYaml(DEFAULT_POLICY));
}
