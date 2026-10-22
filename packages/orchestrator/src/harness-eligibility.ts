import type { HarnessId } from "@relay/schema";
import { isModelProviderAvailable } from "@relay/registry";

export type HarnessEligibilityContext = {
  installed: HarnessId[];
  piAuthProviders?: Set<string>;
  piListedModels?: Array<{ provider: string; modelId: string; spec: string }>;
};

/** Whether a harness can be spawned (installed + auth-aware for Pi). */
export function isHarnessRunnable(
  harness: HarnessId,
  ctx: HarnessEligibilityContext,
): boolean {
  if (!ctx.installed.includes(harness)) return false;
  if (harness !== "pi") return true;

  const auth = ctx.piAuthProviders;
  if (!auth || auth.size === 0) return false;

  const listed = ctx.piListedModels ?? [];
  if (listed.length === 0) return false;

  return listed.some((entry) => isModelProviderAvailable(entry.spec, auth));
}

/** Keep only harnesses that pass install + auth preflight. */
export function filterRunnableHarnesses(
  failover: HarnessId[],
  ctx: HarnessEligibilityContext,
): HarnessId[] {
  return failover.filter((harness) => isHarnessRunnable(harness, ctx));
}
