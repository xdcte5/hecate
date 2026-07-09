import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import {
  ORCHESTRATOR_CONFIG_RELATIVE,
  formatOrchestratorConfig,
  loadOrchestratorConfig,
} from "../orchestrator-config.js";

const SAMPLE = `# relay/orchestrator.yaml — deep customization for the super-harness.
# Every key is optional; delete what you don't need.

# Max agents to run at once within a parallel wave (omit = whole wave).
maxConcurrency: 2

# Run independent tasks as isolated child sub-sessions (default: true).
subSessions: true

# Force a harness per step-kind (implement | implement-frontend |
# implement-backend | test | review | fix). Overrides ability routing.
routing:
  implement: pi
  test: codex
  review: claude-code

# Pin a model per harness (overrides ability-based model routing).
models:
  claude-code: claude-opus-4-6
  gemini-cli: gemini-2.5-pro

# Verification gate between waves.
verify:
  enabled: true
  command: pnpm test    # omit to use the default "files changed" check

# Override a harness's native login command (args passed to its binary).
login:
  gemini-cli: [auth, login]
`;

export function registerConfigCommands(program: Command, getCwd: () => string): void {
  const config = program
    .command("config")
    .description("View or scaffold orchestrator customization (relay/orchestrator.yaml)")
    .action(async () => {
      const cwd = getCwd();
      const loaded = await loadOrchestratorConfig(cwd);
      const path = join(cwd, ORCHESTRATOR_CONFIG_RELATIVE);
      console.log(existsSync(path) ? `Config: ${ORCHESTRATOR_CONFIG_RELATIVE}` : "Config: (defaults — no orchestrator.yaml)");
      console.log("");
      for (const line of formatOrchestratorConfig(loaded)) console.log(`  ${line}`);
      console.log("");
      console.log("Edit relay/orchestrator.yaml, or run `relay config init` to scaffold one.");
    });

  config
    .command("init")
    .description("Write a sample relay/orchestrator.yaml")
    .option("--force", "Overwrite an existing file")
    .action(async (options: { force?: boolean }) => {
      const cwd = getCwd();
      const path = join(cwd, ORCHESTRATOR_CONFIG_RELATIVE);
      if (existsSync(path) && !options.force) {
        console.error(`${ORCHESTRATOR_CONFIG_RELATIVE} already exists. Use --force to overwrite.`);
        process.exitCode = 1;
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, SAMPLE, "utf8");
      console.log(`Wrote ${ORCHESTRATOR_CONFIG_RELATIVE}. Edit it, then run \`relay config\` to verify.`);
    });

  config
    .command("path")
    .description("Print the orchestrator config path")
    .action(() => {
      console.log(join(getCwd(), ORCHESTRATOR_CONFIG_RELATIVE));
    });
}
