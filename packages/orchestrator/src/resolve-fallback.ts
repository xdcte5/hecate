import { loadRelayConfig } from "@relay/registry";
import type { HarnessId, Registry } from "@relay/schema";
import { resolveHarnessBinary } from "./resolve-binary.js";

export async function resolveHarnessWithFallback(
  registry: Registry,
  preferred: HarnessId,
  failover: HarnessId[],
): Promise<{ harness: HarnessId; binary: string; fallback: boolean } | null> {
  const order = [preferred, ...failover.filter((h) => h !== preferred)];

  for (const harness of order) {
    const binary = await resolveHarnessBinary(registry, harness);
    if (binary) {
      return { harness, binary, fallback: harness !== preferred };
    }
  }

  return null;
}

export async function resolveHarnessWithFallbackFromConfig(
  cwd: string,
  preferred: HarnessId,
): Promise<{ harness: HarnessId; binary: string; fallback: boolean } | null> {
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  return resolveHarnessWithFallback(registry, preferred, sessionPolicy.failover);
}
