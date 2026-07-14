import { detectInstalledBinaries } from "@relay/adapters";
import type { HarnessId, Registry } from "@relay/schema";
import { isMockDriverEnabled } from "./drivers/mock.js";

export async function resolveHarnessBinary(
  registry: Registry,
  harness: HarnessId,
): Promise<string | null> {
  if (isMockDriverEnabled()) return "relay-mock";
  const card = registry.harnesses.find((entry) => entry.id === harness);
  if (!card) return null;

  const installed = await detectInstalledBinaries(card.binaries);
  return installed[0] ?? null;
}
