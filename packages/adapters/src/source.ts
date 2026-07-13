import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "@relay/schema";

/** A single markdown source file (agent, skill, or command). */
export interface SourceFile {
  /** Basename including extension, e.g. `reviewer.md`. */
  name: string;
  content: string;
}

/**
 * The canonical `relay/` source, read once and handed to every adapter.
 * Adapters are pure functions of this plus a {@link BuildContext}.
 */
export interface RelaySource {
  /** Project root (the directory that contains `relay/`). */
  root: string;
  /** Base instructions (`relay/instructions.md`), or null if absent. */
  instructions: string | null;
  /** Per-harness instruction overrides, e.g. `instructions.claude.md`. */
  instructionsByHarness: Partial<Record<HarnessId, string>>;
  agents: SourceFile[];
  skills: SourceFile[];
  commands: SourceFile[];
  /** Parsed `relay/mcp.json`, or null if absent. */
  mcp: McpConfig | null;
}

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

const HARNESS_INSTRUCTION_FILES: Record<string, HarnessId> = {
  "instructions.claude.md": "claude-code",
  "instructions.codex.md": "codex",
  "instructions.cursor.md": "cursor",
  "instructions.pi.md": "pi",
  "instructions.antigravity.md": "antigravity",
};

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readDirFiles(dir: string): Promise<SourceFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files: SourceFile[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const full = join(dir, name);
    if (!(await stat(full)).isFile()) continue;
    files.push({ name, content: await readFile(full, "utf8") });
  }
  return files;
}

/** Read `<root>/relay/` into a {@link RelaySource}. Deterministic ordering. */
export async function readRelaySource(root: string): Promise<RelaySource> {
  const relayDir = join(root, "relay");

  const instructions = await readIfExists(join(relayDir, "instructions.md"));

  const instructionsByHarness: Partial<Record<HarnessId, string>> = {};
  for (const [file, harness] of Object.entries(HARNESS_INSTRUCTION_FILES)) {
    const content = await readIfExists(join(relayDir, file));
    if (content !== null) instructionsByHarness[harness] = content;
  }

  const mcpRaw = await readIfExists(join(relayDir, "mcp.json"));
  const mcp = mcpRaw ? (JSON.parse(mcpRaw) as McpConfig) : null;

  return {
    root,
    instructions,
    instructionsByHarness,
    agents: await readDirFiles(join(relayDir, "agents")),
    skills: await readDirFiles(join(relayDir, "skills")),
    commands: await readDirFiles(join(relayDir, "commands")),
    mcp,
  };
}
