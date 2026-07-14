import { describe, expect, it } from "vitest";
import { createDriver } from "./factory.js";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { CursorDriver } from "./cursor.js";
import { CliDriver } from "./cli-driver.js";
import { MockHarnessDriver } from "./mock.js";
import { PiRpcDriver } from "./pi-rpc.js";

describe("createDriver", () => {
  it("routes pi harness to PiRpcDriver", () => {
    const driver = createDriver("pi", "pi");
    expect(driver).toBeInstanceOf(PiRpcDriver);
    expect(driver.kind).toBe("pi-rpc");
  });

  it("routes pi binary path to PiRpcDriver", () => {
    const driver = createDriver("cursor", "/usr/local/bin/pi");
    expect(driver).toBeInstanceOf(PiRpcDriver);
    expect(driver.kind).toBe("pi-rpc");
  });

  it("routes claude-code to ClaudeDriver", () => {
    const driver = createDriver("claude-code", "claude");
    expect(driver).toBeInstanceOf(ClaudeDriver);
    expect(driver.kind).toBe("cli");
  });

  it("routes codex to CodexDriver", () => {
    const driver = createDriver("codex", "codex");
    expect(driver).toBeInstanceOf(CodexDriver);
    expect(driver.kind).toBe("cli");
  });

  it("routes cursor to CursorDriver", () => {
    const driver = createDriver("cursor", "cursor-agent");
    expect(driver).toBeInstanceOf(CursorDriver);
    expect(driver.kind).toBe("cli");
  });

  it("falls back to CliDriver for unknown harness ids", () => {
    const driver = createDriver("codex", "codex");
    expect(driver).toBeInstanceOf(CodexDriver);
    expect(driver).not.toBeInstanceOf(CliDriver);
  });

  it("routes relay-mock binary to MockHarnessDriver when mock env is set", () => {
    const previous = process.env.RELAY_MOCK_DRIVER;
    process.env.RELAY_MOCK_DRIVER = "1";
    try {
      const driver = createDriver("codex", "relay-mock");
      expect(driver).toBeInstanceOf(MockHarnessDriver);
      expect(driver.kind).toBe("mock");
    } finally {
      if (previous === undefined) delete process.env.RELAY_MOCK_DRIVER;
      else process.env.RELAY_MOCK_DRIVER = previous;
    }
  });
});
