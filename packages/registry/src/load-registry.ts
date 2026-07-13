import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  HarnessIdSchema,
  RegistrySchema,
  SessionPolicySchema,
  type Registry,
  type SessionPolicy,
} from "@relay/schema";

export const REGISTRY_RELATIVE_PATH = join("relay", "registry.yaml");
export const SESSION_POLICY_RELATIVE_PATH = join("relay", "session-policy.yaml");

const isKnownHarness = (id: unknown): boolean => HarnessIdSchema.safeParse(id).success;

/**
 * Harness ids change over time (e.g. gemini-cli → antigravity). Rather than
 * crashing an entire session on a stale config, drop entries for harnesses this
 * build no longer knows and warn the user to refresh.
 */
function dropUnknownHarnesses(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const doc = raw as { harnesses?: unknown };
  if (!Array.isArray(doc.harnesses)) return raw;

  const valid = doc.harnesses.filter((card) => isKnownHarness((card as { id?: unknown })?.id));
  const dropped = doc.harnesses.length - valid.length;
  if (dropped > 0) {
    warnStale(`registry.yaml lists ${dropped} harness(es) this build no longer supports`);
  }
  return { ...doc, harnesses: valid };
}

function dropUnknownPolicyHarnesses(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const doc = raw as { failover?: unknown; routing?: unknown };
  const out: Record<string, unknown> = { ...doc };
  if (Array.isArray(doc.failover)) {
    const valid = doc.failover.filter(isKnownHarness);
    if (valid.length !== doc.failover.length) {
      warnStale("session-policy.yaml failover references an unknown harness");
    }
    out.failover = valid;
  }
  if (Array.isArray(doc.routing)) {
    out.routing = doc.routing.filter((rule) => isKnownHarness((rule as { harness?: unknown })?.harness));
  }
  return out;
}

let warnedStale = false;
function warnStale(detail: string): void {
  if (warnedStale) return;
  warnedStale = true;
  console.error(`⚠ ${detail}. Run \`hecate init --force\` to refresh relay/ config.`);
}

export async function loadRegistry(cwd: string): Promise<Registry> {
  const content = await readFile(join(cwd, REGISTRY_RELATIVE_PATH), "utf8");
  return RegistrySchema.parse(dropUnknownHarnesses(parseYaml(content)));
}

export async function loadSessionPolicy(cwd: string): Promise<SessionPolicy> {
  const content = await readFile(join(cwd, SESSION_POLICY_RELATIVE_PATH), "utf8");
  return SessionPolicySchema.parse(dropUnknownPolicyHarnesses(parseYaml(content)));
}

export async function loadRelayConfig(cwd: string): Promise<{
  registry: Registry;
  sessionPolicy: SessionPolicy;
}> {
  const [registry, sessionPolicy] = await Promise.all([
    loadRegistry(cwd),
    loadSessionPolicy(cwd),
  ]);

  return { registry, sessionPolicy };
}
