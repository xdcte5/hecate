import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrchestratorConfig, formatOrchestratorConfig } from "./orchestrator-config.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function write(yaml: string): string {
  tmp = mkdtempSync(join(os.tmpdir(), "relay-orch-"));
  mkdirSync(join(tmp, "relay"), { recursive: true });
  writeFileSync(join(tmp, "relay", "orchestrator.yaml"), yaml);
  return tmp;
}

describe("orchestrator config", () => {
  it("returns empty when the file is absent", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-orch-"));
    expect(await loadOrchestratorConfig(tmp)).toEqual({});
  });

  it("parses a full config", async () => {
    const root = write(
      [
        "maxConcurrency: 2",
        "subSessions: true",
        "routing:",
        "  implement: pi",
        "  test: codex",
        "models:",
        "  claude-code: claude-opus-4-6",
        "verify:",
        "  enabled: false",
        "login:",
        "  antigravity: [auth, login]",
        "",
      ].join("\n"),
    );
    const config = await loadOrchestratorConfig(root);
    expect(config.maxConcurrency).toBe(2);
    expect(config.routing?.implement).toBe("pi");
    expect(config.models?.["claude-code"]).toBe("claude-opus-4-6");
    expect(config.verify?.enabled).toBe(false);
    expect(config.login?.["antigravity"]).toEqual(["auth", "login"]);
  });

  it("rejects an unknown harness id in routing", async () => {
    const root = write("routing:\n  implement: not-a-harness\n");
    await expect(loadOrchestratorConfig(root)).rejects.toThrow();
  });

  it("summarizes for display", () => {
    const lines = formatOrchestratorConfig({ maxConcurrency: 3 });
    expect(lines.join("\n")).toContain("concurrency:  3");
  });
});
