import type { HarnessId } from "@relay/schema";
import { CliDriver } from "./cli-driver.js";
import { PiRpcDriver } from "./pi-rpc.js";
import type { HarnessDriver } from "./types.js";

export function createDriver(harness: HarnessId, binary: string): HarnessDriver {
  if (harness === "pi" || binary.endsWith("/pi") || binary === "pi") {
    return new PiRpcDriver();
  }
  return new CliDriver();
}
