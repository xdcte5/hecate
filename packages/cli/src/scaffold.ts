import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { HarnessId, ModelCard } from "@relay/schema";

export interface DefaultCard {
  id: HarnessId;
  planning?: number;
  conversation?: number;
  capabilities?: string[];
  strengths: string[];
  weaknesses: string[];
  binaries: string[];
  models?: ModelCard[];
}

export const DEFAULT_MODELS: Record<HarnessId, ModelCard[]> = {
  "claude-code": [
    {
      id: "claude-sonnet-4-6",
      planning: 7,
      conversation: 8,
      strengths: ["frontend", "implementation", "reasoning", "debugging"],
      weaknesses: [],
    },
    {
      id: "claude-opus-4-6",
      planning: 10,
      conversation: 8,
      strengths: ["architecture", "refactoring", "complex reasoning", "system design"],
      weaknesses: [],
    },
  ],
  codex: [
    { id: "o4-mini", planning: 4, conversation: 4, strengths: ["unit tests", "test generation", "quick tasks"], weaknesses: [] },
    { id: "o3", planning: 8, conversation: 6, strengths: ["api design", "typescript", "reasoning", "backend"], weaknesses: [] },
  ],
  cursor: [
    {
      id: "composer-2",
      planning: 3,
      conversation: 4,
      strengths: ["react", "frontend", "jsx", "tsx", "ui", "portfolio", "graph", "visualization"],
      weaknesses: [],
    },
    { id: "gpt-5.3-codex", planning: 5, conversation: 5, strengths: ["implementation", "debugging", "backend"], weaknesses: [] },
  ],
  pi: [
    {
      id: "claude-sonnet-4-6",
      planning: 7,
      conversation: 7,
      capabilities: ["native-tool-loop", "extensions"],
      strengths: ["implementation", "greenfield", "scaffolding", "full-stack"],
      weaknesses: [],
    },
    {
      id: "gpt-4o",
      planning: 4,
      conversation: 6,
      capabilities: ["native-tool-loop", "extensions"],
      strengths: ["scripts", "automation", "cli", "shell"],
      weaknesses: [],
    },
  ],
  antigravity: [
    {
      id: "Gemini 3.1 Pro (High)",
      planning: 9,
      conversation: 8,
      strengths: ["long-context", "research", "multimodal", "reasoning", "large codebases"],
      weaknesses: [],
    },
    {
      id: "Claude Sonnet 4.6 (Thinking)",
      planning: 8,
      conversation: 8,
      strengths: ["implementation", "reasoning", "debugging"],
      weaknesses: [],
    },
    {
      id: "Gemini 3.5 Flash (High)",
      planning: 4,
      conversation: 7,
      strengths: ["quick tasks", "summarization", "scripts"],
      weaknesses: [],
    },
  ],
};

export const DEFAULT_CARDS: DefaultCard[] = [
  {
    id: "claude-code",
    planning: 9,
    conversation: 8,
    strengths: ["architecture", "refactoring", "complex reasoning", "system design", "debugging"],
    weaknesses: ["quick edits", "unit tests"],
    binaries: ["claude"],
    models: DEFAULT_MODELS["claude-code"],
  },
  {
    id: "codex",
    planning: 6,
    conversation: 5,
    strengths: ["unit tests", "test generation", "api design", "typescript", "debugging"],
    weaknesses: ["ui work", "frontend styling"],
    binaries: ["codex"],
    models: DEFAULT_MODELS.codex,
  },
  {
    id: "cursor",
    planning: 4,
    conversation: 4,
    strengths: ["react", "frontend", "component fixes", "jsx", "tsx", "ui", "portfolio", "graph", "visualization"],
    weaknesses: ["long-running tasks", "deep architecture"],
    binaries: ["cursor-agent"],
    models: DEFAULT_MODELS.cursor,
  },
  {
    id: "pi",
    planning: 6,
    conversation: 6,
    capabilities: ["native-tool-loop", "extensions"],
    strengths: ["implementation", "greenfield", "scaffolding", "scripts", "automation", "cli", "full-stack"],
    weaknesses: ["complex refactors"],
    binaries: ["pi"],
    models: DEFAULT_MODELS.pi,
  },
  {
    id: "antigravity",
    planning: 8,
    conversation: 8,
    strengths: ["long-context", "research", "multimodal", "large codebases", "documentation"],
    weaknesses: ["unit tests"],
    binaries: ["agy"],
    models: DEFAULT_MODELS.antigravity,
  },
];

export const DEFAULT_INSTRUCTIONS = `# Project instructions

Describe your project's conventions here. This file is the single source of
truth that Relay transpiles into every harness (CLAUDE.md, AGENTS.md, Cursor
rules, Pi overlay). Edit \`relay/\`, never the generated output.
`;

export const DEFAULT_POLICY = {
  routing: [],
  failover: ["pi", "cursor", "claude-code", "codex", "antigravity"],
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
