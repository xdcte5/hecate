import { detectInstalledBinaries } from "@relay/adapters";
import type { HarnessId, Registry } from "@relay/schema";

export async function resolveHarnessBinary(
  registry: Registry,
  harness: HarnessId,
): Promise<string | null> {
  const card = registry.harnesses.find((entry) => entry.id === harness);
  if (!card) return null;

  const installed = await detectInstalledBinaries(card.binaries);
  return installed[0] ?? null;
}
