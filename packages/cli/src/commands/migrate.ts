import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { DEFAULT_CARDS, writeBaseScaffold } from "../scaffold.js";

type MigrateSource = "agents-md";
const SUPPORTED: MigrateSource[] = ["agents-md"];

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

/**
 * Import an existing AGENTS.md project into a `relay/` source: the AGENTS.md
 * body becomes `relay/instructions.md`, and any sibling `agents/`, `skills/`,
 * `prompts/`, and `mcp.json` are pulled in. Base registry/policy are scaffolded
 * where missing. Existing `relay/` files are preserved unless `--force`.
 */
async function migrateFromAgentsMd(cwd: string, force: boolean): Promise<void> {
  const relayDir = join(cwd, "relay");
  const agentsMd = join(cwd, "AGENTS.md");

  if (!existsSync(agentsMd)) {
    throw new Error("No AGENTS.md found in the current directory.");
  }

  // Capture whether the user already had hand-written instructions *before*
  // scaffolding creates a default placeholder.
  const instructionsPath = join(relayDir, "instructions.md");
  const hadInstructions = existsSync(instructionsPath);

  await writeBaseScaffold(relayDir, DEFAULT_CARDS, { overwrite: false });

  if (force || !hadInstructions) {
    await writeFile(instructionsPath, await readFile(agentsMd, "utf8"), "utf8");
  }

  const agents = await importMarkdownDir(join(cwd, "agents"), join(relayDir, "agents"));
  const skills = await importMarkdownDir(join(cwd, "skills"), join(relayDir, "skills"));
  const prompts = await importMarkdownDir(join(cwd, "prompts"), join(relayDir, "commands"));

  let mcp = 0;
  const mcpSource = existsSync(join(cwd, "mcp.json"))
    ? join(cwd, "mcp.json")
    : existsSync(join(cwd, ".mcp.json"))
      ? join(cwd, ".mcp.json")
      : null;
  if (mcpSource) {
    await copyFile(mcpSource, join(relayDir, "mcp.json"));
    mcp = 1;
  }

  console.log("Migrated AGENTS.md → relay/instructions.md");
  console.log(`Imported: ${agents} agent(s), ${skills} skill(s), ${prompts} prompt(s), ${mcp} mcp config`);
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
      if (options.from !== "agents-md") {
        console.error(`Unsupported --from: ${options.from}. Supported: ${SUPPORTED.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      await migrateFromAgentsMd(cwd, options.force ?? false);
    });
}
