import type { McpConfig, McpServer } from "./source.js";

/**
 * MCP config transforms — the canonical `relay/mcp.json` shape rendered into
 * each harness's native format.
 *
 * Sprint 1 covers Claude JSON (passthrough) and Codex TOML, which the Claude
 * and Codex adapters need to emit. Cursor JSON and round-trip parsing land in
 * Sprint 3 (`mcp-transform` full).
 */

function sortedServers(config: McpConfig): Record<string, McpServer> {
  const servers: Record<string, McpServer> = {};
  for (const name of Object.keys(config.mcpServers).sort()) {
    servers[name] = config.mcpServers[name]!;
  }
  return servers;
}

/** Claude Code `.mcp.json` — same shape as canonical. Deterministic key order. */
export function toClaudeJson(config: McpConfig): string {
  return `${JSON.stringify({ mcpServers: sortedServers(config) }, null, 2)}\n`;
}

/** Cursor `.cursor/mcp.json` — same `mcpServers` shape as Claude. */
export function toCursorJson(config: McpConfig): string {
  return `${JSON.stringify({ mcpServers: sortedServers(config) }, null, 2)}\n`;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

/** Codex `.codex/config.toml` — `[mcp_servers.<name>]` tables. */
export function toCodexToml(config: McpConfig): string {
  const blocks: string[] = [];
  for (const name of Object.keys(config.mcpServers).sort()) {
    const server = config.mcpServers[name]!;
    const lines = [`[mcp_servers.${name}]`, `command = ${tomlString(server.command)}`];
    lines.push(`args = ${tomlStringArray(server.args ?? [])}`);
    blocks.push(lines.join("\n"));

    const env = server.env ?? {};
    const envKeys = Object.keys(env).sort();
    if (envKeys.length > 0) {
      const envLines = [`[mcp_servers.${name}.env]`];
      for (const key of envKeys) envLines.push(`${key} = ${tomlString(env[key]!)}`);
      blocks.push(envLines.join("\n"));
    }
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}
