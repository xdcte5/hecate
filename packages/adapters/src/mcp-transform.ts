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

/** Parse a Claude/Cursor `mcpServers` JSON document back into an McpConfig. */
export function fromClaudeJson(json: string): McpConfig {
  const parsed = JSON.parse(json) as Partial<McpConfig>;
  return { mcpServers: parsed.mcpServers ?? {} };
}

/** Cursor uses the same JSON shape as Claude. */
export const fromCursorJson = fromClaudeJson;

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

function parseTomlString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseTomlStringArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((item) => parseTomlString(item));
}

/**
 * Parse the narrow `[mcp_servers.<name>]` TOML that {@link toCodexToml} emits
 * back into an McpConfig. Not a general TOML parser — it round-trips Relay's
 * own output.
 */
export function fromCodexToml(toml: string): McpConfig {
  const servers: Record<string, McpServer> = {};
  let currentName: string | null = null;
  let inEnv = false;

  for (const line of toml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const header = /^\[mcp_servers\.([^\].]+)(\.env)?\]$/.exec(trimmed);
    if (header) {
      currentName = header[1]!;
      inEnv = header[2] === ".env";
      if (!servers[currentName]) servers[currentName] = { command: "", args: [] };
      if (inEnv && !servers[currentName]!.env) servers[currentName]!.env = {};
      continue;
    }

    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!kv || !currentName) continue;
    const [, key, value] = kv;
    const server = servers[currentName]!;

    if (inEnv) {
      server.env![key!] = parseTomlString(value!);
    } else if (key === "command") {
      server.command = parseTomlString(value!);
    } else if (key === "args") {
      server.args = parseTomlStringArray(value!);
    }
  }

  return { mcpServers: servers };
}
