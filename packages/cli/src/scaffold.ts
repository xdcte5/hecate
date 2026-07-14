import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { HarnessId, ModelCard } from "@relay/schema";

export interface DefaultCard {
  id: HarnessId;
  strengths: string[];
  weaknesses: string[];
  binaries: string[];
  models?: ModelCard[];
}

export const DEFAULT_MODELS: Record<HarnessId, ModelCard[]> = {
  "claude-code": [
    {
      id: "claude-sonnet-4-6",
      strengths: ["frontend", "implementation", "reasoning", "debugging"],
      weaknesses: [],
    },
    {
      id: "claude-opus-4-6",
      strengths: ["architecture", "refactoring", "complex reasoning", "system design"],
      weaknesses: [],
    },
  ],
  codex: [
    { id: "o4-mini", strengths: ["unit tests", "test generation", "quick tasks"], weaknesses: [] },
    { id: "o3", strengths: ["api design", "typescript", "reasoning", "backend"], weaknesses: [] },
  ],
  cursor: [
    {
      id: "composer-2",
      strengths: ["react", "frontend", "jsx", "tsx", "ui", "portfolio", "graph", "visualization"],
      weaknesses: [],
    },
    { id: "gpt-5.3-codex", strengths: ["implementation", "debugging", "backend"], weaknesses: [] },
  ],
  pi: [
    {
      id: "claude-sonnet-4-6",
      strengths: ["implementation", "greenfield", "scaffolding", "full-stack"],
      weaknesses: [],
    },
    { id: "gpt-4o", strengths: ["scripts", "automation", "cli", "shell"], weaknesses: [] },
  ],
};

export const DEFAULT_CARDS: DefaultCard[] = [
  {
    id: "claude-code",
    strengths: ["architecture", "refactoring", "complex reasoning", "system design", "debugging"],
    weaknesses: ["quick edits", "unit tests"],
    binaries: ["claude"],
    models: DEFAULT_MODELS["claude-code"],
  },
  {
    id: "codex",
    strengths: ["unit tests", "test generation", "api design", "typescript", "debugging"],
    weaknesses: ["ui work", "frontend styling"],
    binaries: ["codex"],
    models: DEFAULT_MODELS.codex,
  },
  {
    id: "cursor",
    strengths: ["react", "frontend", "component fixes", "jsx", "tsx", "ui", "portfolio", "graph", "visualization"],
    weaknesses: ["long-running tasks", "deep architecture"],
    binaries: ["cursor-agent"],
    models: DEFAULT_MODELS.cursor,
  },
  {
    id: "pi",
    strengths: ["implementation", "greenfield", "scaffolding", "scripts", "automation", "cli", "full-stack"],
    weaknesses: ["complex refactors"],
    binaries: ["pi"],
    models: DEFAULT_MODELS.pi,
  },
];

export const DEFAULT_INSTRUCTIONS = `# Project instructions

Describe your project's conventions here. This file is the single source of
truth that Relay transpiles into every harness (CLAUDE.md, AGENTS.md, Cursor
rules, Pi overlay). Edit \`relay/\`, never the generated output.
`;

export const DEFAULT_POLICY = {
  routing: [],
  // Pi first — breaks ability-score ties for implement steps.
  failover: ["pi", "cursor", "claude-code", "codex"],
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
