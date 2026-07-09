import { describe, expect, it } from "vitest";
import { toClaudeJson, toCodexToml } from "./mcp-transform.js";
import type { McpConfig } from "./source.js";

const config: McpConfig = {
  mcpServers: {
    relay: { command: "relay-mcp", args: [], env: {} },
    weather: { command: "weather-mcp", args: ["--units", "c"], env: { API_KEY: "x" } },
  },
};

describe("toClaudeJson", () => {
  it("emits canonical mcpServers shape with sorted keys", () => {
    const out = JSON.parse(toClaudeJson(config)) as McpConfig;
    expect(Object.keys(out.mcpServers)).toEqual(["relay", "weather"]);
    expect(out.mcpServers.weather!.args).toEqual(["--units", "c"]);
  });
});

describe("toCodexToml", () => {
  it("renders one table per server, sorted, with env sub-tables", () => {
    const toml = toCodexToml(config);
    expect(toml).toContain("[mcp_servers.relay]");
    expect(toml).toContain('command = "weather-mcp"');
    expect(toml).toContain('args = ["--units", "c"]');
    expect(toml).toContain("[mcp_servers.weather.env]");
    expect(toml).toContain('API_KEY = "x"');
    // relay (no env) comes before weather; relay has no env sub-table
    expect(toml.indexOf("[mcp_servers.relay]")).toBeLessThan(
      toml.indexOf("[mcp_servers.weather]"),
    );
  });

  it("returns empty string for no servers", () => {
    expect(toCodexToml({ mcpServers: {} })).toBe("");
  });
});
