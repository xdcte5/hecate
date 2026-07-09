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

  it("errors on an unsupported source", () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-migrate-"));
    expect(() => run(tmp, ["migrate", "--from", "nonsense"])).toThrow();
  });
});
