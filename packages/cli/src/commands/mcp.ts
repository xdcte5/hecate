import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { toClaudeJson, toCodexToml, toCursorJson, type McpConfig } from "@relay/adapters";

/**
 * Built-in tools the relay-mcp server exposes. Kept in sync with
 * `@relay/mcp` (server.ts); hardcoded here so the CLI stays free of the MCP
 * SDK dependency.
 */
const RELAY_MCP_TOOLS = [
  "session_get",
  "session_record_decision",
  "session_record_progress",
  "handoff_prepare",
  "registry_list",
] as const;

/** Where each harness expects its MCP config, and how to render it. */
const MCP_TARGETS: { harness: string; path: string; render: (c: McpConfig) => string }[] = [
  { harness: "claude-code", path: ".mcp.json", render: toClaudeJson },
  { harness: "codex", path: ".codex/config.toml", render: toCodexToml },
  { harness: "cursor", path: ".cursor/mcp.json", render: toCursorJson },
  { harness: "pi", path: "mcp.json", render: toClaudeJson },
];

async function readCanonicalMcp(cwd: string): Promise<McpConfig> {
  const path = join(cwd, "relay", "mcp.json");
  if (!existsSync(path)) return { mcpServers: {} };
  return JSON.parse(await readFile(path, "utf8")) as McpConfig;
}

/** Ensure the relay-mcp server itself is registered in the canonical config. */
function withRelayServer(config: McpConfig): McpConfig {
  if (config.mcpServers.relay) return config;
  return {
    mcpServers: { relay: { command: "relay-mcp", args: [] }, ...config.mcpServers },
  };
}

export function registerMcpCommands(program: Command, getCwd: () => string): void {
  const mcp = program.command("mcp").description("MCP mesh fabric");

  mcp
    .command("install")
    .description("Write MCP config (incl. relay-mcp) into every harness")
    .action(async () => {
      const cwd = getCwd();
      const config = withRelayServer(await readCanonicalMcp(cwd));

      for (const target of MCP_TARGETS) {
        const abs = join(cwd, target.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, target.render(config), "utf8");
        console.log(`${target.harness}: ${target.path}`);
      }
      console.log(`Installed ${Object.keys(config.mcpServers).length} MCP server(s) across ${MCP_TARGETS.length} harnesses`);
    });

  mcp
    .command("list")
    .description("Show the merged virtual MCP surface")
    .action(async () => {
      const cwd = getCwd();
      const config = withRelayServer(await readCanonicalMcp(cwd));

      console.log("Servers (relay/mcp.json):");
      for (const name of Object.keys(config.mcpServers).sort()) {
        const server = config.mcpServers[name]!;
        console.log(`  ${name}\t${server.command} ${(server.args ?? []).join(" ")}`.trimEnd());
      }
      console.log("");
      console.log("relay-mcp built-in tools:");
      for (const tool of RELAY_MCP_TOOLS) console.log(`  ${tool}`);
    });
}
