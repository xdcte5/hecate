import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cli = join(fileURLToPath(new URL(".", import.meta.url)), "../../dist/index.js");

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function run(cwd: string, args: string[]): string {
  return execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" });
}

describe("relay migrate --from agents-md", () => {
  it("imports AGENTS.md into relay/instructions.md and scaffolds base config", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-migrate-"));
    writeFileSync(join(tmp, "AGENTS.md"), "# House rules\n\nUse strict TS.\n");
    mkdirSync(join(tmp, "agents"));
    writeFileSync(join(tmp, "agents", "helper.md"), "# helper\n");

    const out = run(tmp, ["migrate", "--from", "agents-md"]);
    expect(out).toContain("Migrated AGENTS.md");

    expect(readFileSync(join(tmp, "relay/instructions.md"), "utf8")).toContain("House rules");
    expect(readFileSync(join(tmp, "relay/agents/helper.md"), "utf8")).toContain("helper");
    // base config scaffolded
    expect(readFileSync(join(tmp, "relay/registry.yaml"), "utf8")).toContain("claude-code");
  });

  it("imports a Claude layout (CLAUDE.md + .claude/ + .mcp.json)", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-migrate-"));
    writeFileSync(join(tmp, "CLAUDE.md"), "# Claude rules\n");
    mkdirSync(join(tmp, ".claude/agents"), { recursive: true });
    writeFileSync(join(tmp, ".claude/agents/rev.md"), "# rev\n");
    writeFileSync(join(tmp, ".mcp.json"), '{"mcpServers":{"foo":{"command":"foo","args":[]}}}');

    run(tmp, ["migrate", "--from", "claude"]);
    expect(readFileSync(join(tmp, "relay/instructions.md"), "utf8")).toContain("Claude rules");
    expect(readFileSync(join(tmp, "relay/agents/rev.md"), "utf8")).toContain("rev");
    expect(readFileSync(join(tmp, "relay/mcp.json"), "utf8")).toContain("foo");
  });

  it("imports a Codex config.toml into relay/mcp.json", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-migrate-"));
    writeFileSync(join(tmp, "AGENTS.md"), "# Codex rules\n");
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    writeFileSync(join(tmp, ".codex/config.toml"), '[mcp_servers.bar]\ncommand = "bar"\nargs = []\n');

    run(tmp, ["migrate", "--from", "codex"]);
    const mcp = JSON.parse(readFileSync(join(tmp, "relay/mcp.json"), "utf8"));
    expect(mcp.mcpServers.bar.command).toBe("bar");
  });

  it("errors on an unsupported source", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-migrate-"));
    expect(() => run(tmp, ["migrate", "--from", "nonsense"])).toThrow();
  });
});
