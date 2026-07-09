import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultLocalConfig,
  readLocalConfig,
  writeLocalConfig,
  formatLocalConfigSummary,
} from "./local-config.js";

let tmp = "";

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("local-config", () => {
  it("returns defaults when file is missing", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-local-config-"));
    const config = await readLocalConfig(tmp);
    expect(config).toEqual(defaultLocalConfig());
  });

  it("round-trips enabled agents and model overrides", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-local-config-"));
    await writeLocalConfig(tmp, {
      enabledAgents: ["pi", "codex"],
      modelOverrides: { "claude-code": "claude-sonnet-4-6" },
      modelMode: "manual",
    });

    const loaded = await readLocalConfig(tmp);
    expect(loaded.enabledAgents).toEqual(["pi", "codex"]);
    expect(loaded.modelOverrides["claude-code"]).toBe("claude-sonnet-4-6");
    expect(loaded.modelMode).toBe("manual");

    const raw = JSON.parse(readFileSync(join(tmp, ".relay/local-config.json"), "utf8"));
    expect(raw.enabledAgents).toContain("pi");
  });

  it("formats a readable summary", () => {
    const lines = formatLocalConfigSummary({
      enabledAgents: ["pi"],
      modelOverrides: {},
      modelMode: "auto",
    });
    expect(lines[0]).toContain("pi");
    expect(lines[1]).toContain("auto");
  });
});
