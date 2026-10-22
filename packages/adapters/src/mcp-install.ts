import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { toClaudeJson, toCodexToml, toCursorJson } from "./mcp-transform.js";
import type { McpConfig } from "./source.js";

/** Where each harness expects its MCP config, and how to render it. */
export const MCP_INSTALL_TARGETS: {
  harness: string;
  path: string;
  render: (c: McpConfig) => string;
}[] = [
  { harness: "claude-code", path: ".mcp.json", render: toClaudeJson },
  { harness: "codex", path: ".codex/config.toml", render: toCodexToml },
  { harness: "cursor", path: ".cursor/mcp.json", render: toCursorJson },
  { harness: "pi", path: "mcp.json", render: toClaudeJson },
];

export const RELAY_MCP_CANONICAL_PATH = join("relay", "mcp.json");

export async function readCanonicalMcp(cwd: string): Promise<McpConfig> {
  const path = join(cwd, RELAY_MCP_CANONICAL_PATH);
  if (!existsSync(path)) return { mcpServers: {} };
  return JSON.parse(await readFile(path, "utf8")) as McpConfig;
}

/** Ensure the relay-mcp server itself is registered in the canonical config. */
export function withRelayServer(config: McpConfig): McpConfig {
  if (config.mcpServers.relay) return config;
  return {
    mcpServers: { relay: { command: "relay-mcp", args: [] }, ...config.mcpServers },
  };
}

export type McpInstallResult = {
  targets: Array<{ harness: string; path: string }>;
  serverCount: number;
};

/** Write MCP config (incl. relay-mcp) into every harness target directory. */
export async function installMcpHarnessConfigs(cwd: string): Promise<McpInstallResult> {
  const config = withRelayServer(await readCanonicalMcp(cwd));
  const targets: McpInstallResult["targets"] = [];

  for (const target of MCP_INSTALL_TARGETS) {
    const abs = join(cwd, target.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, target.render(config), "utf8");
    targets.push({ harness: target.harness, path: target.path });
  }

  return { targets, serverCount: Object.keys(config.mcpServers).length };
}
