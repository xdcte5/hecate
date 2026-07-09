import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { fromCodexToml, toClaudeJson } from "@relay/adapters";
import { DEFAULT_CARDS, writeBaseScaffold } from "../scaffold.js";

const SUPPORTED = ["agents-md", "claude", "codex"] as const;
type MigrateSource = (typeof SUPPORTED)[number];

interface SourcePlan {
  /** Instruction file to import into relay/instructions.md. */
  instructions: string;
  /** Markdown dirs to copy: [from, relaySubdir]. */
  markdownDirs: [string, string][];
  /** Optional MCP import. */
  mcp?: { path: string; format: "json" | "codex-toml" };
}

function planFor(source: MigrateSource): SourcePlan {
  switch (source) {
    case "agents-md":
      return {
        instructions: "AGENTS.md",
        markdownDirs: [["agents", "agents"], ["skills", "skills"], ["prompts", "commands"]],
        mcp: { path: "mcp.json", format: "json" },
      };
    case "claude":
      return {
        instructions: "CLAUDE.md",
        markdownDirs: [
          [".claude/agents", "agents"],
          [".claude/skills", "skills"],
          [".claude/commands", "commands"],
        ],
        mcp: { path: ".mcp.json", format: "json" },
      };
    case "codex":
      return {
        instructions: "AGENTS.md",
        markdownDirs: [[".codex/skills", "skills"]],
        mcp: { path: ".codex/config.toml", format: "codex-toml" },
      };
  }
}

async function importMarkdownDir(from: string, to: string): Promise<number> {
  if (!existsSync(from)) return 0;
  await mkdir(to, { recursive: true });
  let count = 0;
  for (const name of (await readdir(from)).sort()) {
    if (!name.endsWith(".md")) continue;
    await copyFile(join(from, name), join(to, name));
    count += 1;
  }
  return count;
}

async function importMcp(cwd: string, relayDir: string, plan: SourcePlan): Promise<number> {
  if (!plan.mcp) return 0;
  const src = join(cwd, plan.mcp.path);
  if (!existsSync(src)) return 0;

  const dest = join(relayDir, "mcp.json");
  if (plan.mcp.format === "codex-toml") {
    const config = fromCodexToml(await readFile(src, "utf8"));
    await writeFile(dest, toClaudeJson(config), "utf8");
  } else {
    await copyFile(src, dest);
  }
  return 1;
}

async function migrate(cwd: string, source: MigrateSource, force: boolean): Promise<void> {
  const relayDir = join(cwd, "relay");
  const plan = planFor(source);
  const instructionsSrc = join(cwd, plan.instructions);

  if (!existsSync(instructionsSrc)) {
    throw new Error(`No ${plan.instructions} found in the current directory.`);
  }

  const instructionsPath = join(relayDir, "instructions.md");
  const hadInstructions = existsSync(instructionsPath);

  await writeBaseScaffold(relayDir, DEFAULT_CARDS, { overwrite: false });

  if (force || !hadInstructions) {
    await writeFile(instructionsPath, await readFile(instructionsSrc, "utf8"), "utf8");
  }

  const counts: Record<string, number> = {};
  for (const [from, sub] of plan.markdownDirs) {
    counts[sub] = (counts[sub] ?? 0) + (await importMarkdownDir(join(cwd, from), join(relayDir, sub)));
  }
  const mcp = await importMcp(cwd, relayDir, plan);

  console.log(`Migrated ${plan.instructions} → relay/instructions.md`);
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
  console.log(`Imported: ${parts.join(", ")}, ${mcp} mcp config`);
  console.log("Next: review relay/, then `relay build --all`.");
}

export function registerMigrateCommands(program: Command, getCwd: () => string): void {
  program
    .command("migrate")
    .description("Import an existing config into relay/")
    .requiredOption("--from <source>", `Source format: ${SUPPORTED.join(", ")}`)
    .option("--force", "Overwrite relay/instructions.md if it exists")
    .action(async (options: { from: string; force?: boolean }) => {
      const cwd = getCwd();
      if (!SUPPORTED.includes(options.from as MigrateSource)) {
        console.error(`Unsupported --from: ${options.from}. Supported: ${SUPPORTED.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      await migrate(cwd, options.from as MigrateSource, options.force ?? false);
    });
}
