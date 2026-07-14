import type { HarnessId } from "@relay/schema";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { CursorDriver } from "./cursor.js";
import { CliDriver } from "./cli-driver.js";
import { isMockDriverEnabled, MockHarnessDriver } from "./mock.js";
import { PiRpcDriver } from "./pi-rpc.js";
import type { HarnessDriver } from "./types.js";

export function createDriver(harness: HarnessId, binary: string): HarnessDriver {
  if (isMockDriverEnabled() || binary === "relay-mock") {
    return new MockHarnessDriver();
  }
  if (harness === "pi" || binary.endsWith("/pi") || binary === "pi") {
    return new PiRpcDriver();
  }
  switch (harness) {
    case "claude-code":
      return new ClaudeDriver();
    case "codex":
      return new CodexDriver();
    case "cursor":
      return new CursorDriver();
    default:
      return new CliDriver();
  }
}
