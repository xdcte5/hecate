import { Command } from "commander";
import {
  installMcpHarnessConfigs,
  readCanonicalMcp,
  withRelayServer,
} from "@relay/adapters";

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

export function registerMcpCommands(program: Command, getCwd: () => string): void {
  const mcp = program.command("mcp").description("MCP mesh fabric");

  mcp
    .command("install")
    .description("Write MCP config (incl. relay-mcp) into every harness")
    .action(async () => {
      const cwd = getCwd();
      const result = await installMcpHarnessConfigs(cwd);

      for (const target of result.targets) {
        console.log(`${target.harness}: ${target.path}`);
      }
      console.log(
        `Installed ${result.serverCount} MCP server(s) across ${result.targets.length} harnesses`,
      );
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
