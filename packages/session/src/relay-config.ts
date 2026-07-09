import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { RelayConfigSchema, type RelayConfig } from "@relay/schema";
import { atomicWriteFile } from "./_vendor/ide-bridge/atomic-save.js";
import { RELAY_CONFIG_RELATIVE_PATH } from "./relay-config-path.js";

export async function loadRelayConfig(rootDir: string): Promise<RelayConfig> {
  try {
    const content = await readFile(join(rootDir, RELAY_CONFIG_RELATIVE_PATH), "utf8");
    return RelayConfigSchema.parse(parseYaml(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: "1" };
    }
    throw error;
  }
}

export async function saveRelayConfig(
  rootDir: string,
  config: RelayConfig,
): Promise<void> {
  const parsed = RelayConfigSchema.parse(config);
  const content = [
    "# Relay project config — Dev A owns activeSessionId",
    `version: "${parsed.version}"`,
    parsed.activeSessionId ? `activeSessionId: "${parsed.activeSessionId}"` : "",
    "",
  ]
    .filter((line, i, arr) => line !== "" || i === arr.length - 1)
    .join("\n");
  await atomicWriteFile(join(rootDir, RELAY_CONFIG_RELATIVE_PATH), content);
}

export async function setActiveSessionId(
  rootDir: string,
  sessionId: string,
): Promise<void> {
  const config = await loadRelayConfig(rootDir);
  await saveRelayConfig(rootDir, { ...config, activeSessionId: sessionId });
}
