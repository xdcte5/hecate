import { SessionStore } from "@relay/session";
import {
  detectInstalledBinaries,
  detectPiAuthProviders,
  discoverPiListedModels,
  resolveBinaryPath,
} from "@relay/adapters";
import { filterRunnableHarnesses } from "@relay/orchestrator";
import { getHarnessLocalStats, isHarnessExcludedByConfidence, loadRelayConfig } from "@relay/registry";
import type { HarnessId, Registry, SessionPolicy } from "@relay/schema";
import { resolveSessionPolicyRoutingConfig } from "@relay/schema";
import {
  inferTaskType,
  loadRoutingPriors,
  loadRoutingStats,
  previewRoute,
  resolveHandoffRouting,
  summarizeLocalStats,
  topPriorsByTaskType,
} from "./blended.js";

const EXAMPLE_TASK = "fix React component";

async function resolveRunnableFailover(
  policy: SessionPolicy,
  registry: Registry,
): Promise<HarnessId[]> {
  const installed: HarnessId[] = [];
  for (const card of registry.harnesses) {
    const found = await detectInstalledBinaries(card.binaries);
    if (found.length > 0) installed.push(card.id);
  }

  const piInstalled = installed.includes("pi");
  const piBinary = piInstalled ? await resolveBinaryPath("pi") : null;
  const [piAuthProviders, piListedModels] = piInstalled
    ? await Promise.all([
        detectPiAuthProviders(),
        piBinary ? discoverPiListedModels(piBinary) : Promise.resolve([]),
      ])
    : [undefined, []];

  return filterRunnableHarnesses(policy.failover, {
    installed,
    piAuthProviders: piAuthProviders ? new Set([...piAuthProviders].map(String)) : undefined,
    piListedModels,
  });
}

export async function printRoutingDiagnostics(cwd: string): Promise<void> {
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const routingConfig = resolveSessionPolicyRoutingConfig(sessionPolicy);
  const runnableFailover = await resolveRunnableFailover(sessionPolicy, registry);

  console.log("Routing diagnostics");
  console.log("");
  console.log("routing_config (relay/session-policy.yaml):");
  console.log(`  mode: ${routingConfig.mode}`);
  console.log(`  min_local_samples: ${routingConfig.min_local_samples}`);
  console.log(`  min_success_rate: ${routingConfig.min_success_rate}`);
  console.log(
    `  blend: local=${routingConfig.blend.local} benchmark=${routingConfig.blend.benchmark} heuristic=${routingConfig.blend.heuristic} cost=${routingConfig.blend.cost}`,
  );
  console.log("");

  const priors = await loadRoutingPriors(cwd);
  console.log("Benchmark priors (relay/routing-priors.yaml):");
  if (!priors) {
    console.log("  (not found — add relay/routing-priors.yaml or run relay build)");
  } else {
    if (priors.updated) console.log(`  updated: ${priors.updated}`);
    if (priors.sources?.length) console.log(`  sources: ${priors.sources.join(", ")}`);
    const tops = topPriorsByTaskType(priors);
    if (tops.length === 0) {
      console.log("  (no task_types entries)");
    } else {
      for (const row of tops) {
        console.log(`  ${row.taskType}: ${row.target} (${row.score.toFixed(2)})`);
      }
    }
  }
  console.log("");

  const stats = await loadRoutingStats(cwd);
  console.log("Local stats (.relay/routing-stats.jsonl):");
  if (stats.length === 0) {
    console.log("  (not found — no local routing history yet)");
  } else {
    console.log(`  records: ${stats.length}`);
    const combos = summarizeLocalStats(stats).slice(0, 5);
    console.log("  top combos by success rate:");
    for (const combo of combos) {
      const rate = combo.total > 0 ? combo.successes / combo.total : 0;
      console.log(`    ${combo.key} — ${combo.successes}/${combo.total} (${(rate * 100).toFixed(0)}%)`);
    }

    console.log("  last 5 outcomes:");
    for (const outcome of stats.slice(-5).reverse()) {
      const cost =
        outcome.costUsd !== undefined ? `$${outcome.costUsd.toFixed(4)}` : "—";
      const failover = outcome.failoverReason ?? "—";
      console.log(
        `    ${outcome.harness} ${outcome.taskType} ok=${outcome.ok} cost=${cost} failover=${failover}`,
      );
    }
  }
  console.log("");

  const store = new SessionStore({ rootDir: cwd });
  const active = await store.getActive();
  const previewTask = active?.goal ?? EXAMPLE_TASK;
  const previewLabel = active ? `active session goal` : `example task`;
  const previewTaskType = inferTaskType(previewTask);

  console.log(`Local samples for task type "${previewTaskType}" (vs min_local_samples=${routingConfig.min_local_samples}):`);
  for (const harness of sessionPolicy.failover) {
    const { count, rate } = getHarnessLocalStats(stats, previewTaskType, harness);
    const samplesLabel =
      count >= routingConfig.min_local_samples
        ? `${count}/${routingConfig.min_local_samples} (${(rate * 100).toFixed(0)}%)`
        : `${count}/${routingConfig.min_local_samples}`;
    console.log(`  ${harness}: ${samplesLabel}`);
  }

  const excluded = sessionPolicy.failover.filter((harness) =>
    isHarnessExcludedByConfidence(
      stats,
      previewTaskType,
      harness,
      routingConfig.min_local_samples,
      routingConfig.min_success_rate,
    ),
  );
  console.log("");
  console.log(
    `Confidence exclusions (local rate < ${routingConfig.min_success_rate} with enough samples):`,
  );
  if (excluded.length === 0) {
    console.log("  (none)");
  } else {
    for (const harness of excluded) {
      const { count, rate } = getHarnessLocalStats(stats, previewTaskType, harness);
      console.log(`  ${harness}: ${(rate * 100).toFixed(0)}% over ${count} samples`);
    }
  }
  console.log("");

  console.log("Runnable preflight:");
  console.log(
    runnableFailover.length > 0
      ? `  ${runnableFailover.join(", ")}`
      : "  (none — run /login or native agent auth)",
  );
  console.log("");

  try {
    const route =
      runnableFailover.length > 0
        ? await resolveHandoffRouting(cwd, previewTask, registry, {
            ...sessionPolicy,
            failover: runnableFailover,
          })
        : await previewRoute(cwd, previewTask);
    console.log(`Route preview (${previewLabel}: "${previewTask}"):`);
    console.log(`  harness: ${route.harness}`);
    console.log(`  reason: ${formatRouteReason(route)}`);
    if (route.signals?.length) {
      console.log(`  signals: ${route.signals.join(", ")}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Route preview (${previewLabel}: "${previewTask}"):`);
    console.log(`  (unavailable — ${message})`);
  }
}

export function formatRouteReason(route: {
  reason: string;
  pattern?: string;
  score?: number;
  blendScores?: { local: number; benchmark: number; heuristic: number };
}): string {
  switch (route.reason) {
    case "blended":
      if (route.blendScores) {
        const { local, benchmark, heuristic } = route.blendScores;
        return `blended (local:${local.toFixed(2)} bench:${benchmark.toFixed(2)} heur:${heuristic.toFixed(2)})`;
      }
      return "blended";
    case "routing-rule":
      return route.pattern
        ? `routing-rule (pattern: ${route.pattern})`
        : "routing-rule";
    case "benchmark":
      return route.score !== undefined
        ? `benchmark (score: ${route.score.toFixed(2)})`
        : "benchmark";
    case "ability-match":
      return `ability-match (score: ${route.score ?? 0})`;
    case "failover":
      return "failover";
    default:
      return route.reason;
  }
}
