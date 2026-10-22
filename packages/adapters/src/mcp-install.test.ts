import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installMcpHarnessConfigs,
  readCanonicalMcp,
  withRelayServer,
} from "./mcp-install.js";

describe("mcp-install", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("reads empty config when relay/mcp.json is missing", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-mcp-install-"));
    await expect(readCanonicalMcp(tmp)).resolves.toEqual({ mcpServers: {} });
  });

  it("adds relay-mcp server when absent", () => {
    const config = withRelayServer({ mcpServers: { foo: { command: "foo", args: [] } } });
    expect(config.mcpServers.relay).toEqual({ command: "relay-mcp", args: [] });
    expect(config.mcpServers.foo).toEqual({ command: "foo", args: [] });
  });

  it("writes harness MCP configs from relay/mcp.json", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-mcp-install-"));
    mkdirSync(join(tmp, "relay"), { recursive: true });
    writeFileSync(
      join(tmp, "relay/mcp.json"),
      JSON.stringify({ mcpServers: { demo: { command: "demo", args: [] } } }),
    );

    const result = await installMcpHarnessConfigs(tmp);

    expect(result.serverCount).toBe(2);
    expect(result.targets.map((target) => target.path)).toEqual([
      ".mcp.json",
      ".codex/config.toml",
      ".cursor/mcp.json",
      "mcp.json",
    ]);

    const claude = JSON.parse(readFileSync(join(tmp, ".mcp.json"), "utf8"));
    expect(claude.mcpServers.relay.command).toBe("relay-mcp");
    expect(claude.mcpServers.demo.command).toBe("demo");

    const pi = JSON.parse(readFileSync(join(tmp, "mcp.json"), "utf8"));
    expect(pi.mcpServers.relay.command).toBe("relay-mcp");

    const codex = readFileSync(join(tmp, ".codex/config.toml"), "utf8");
    expect(codex).toContain('[mcp_servers.relay]');
    expect(codex).toContain('[mcp_servers.demo]');
  });
});
