import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  RegistrySchema,
  SessionPolicySchema,
  type Registry,
  type SessionPolicy,
} from "@relay/schema";

export const REGISTRY_RELATIVE_PATH = join("relay", "registry.yaml");
export const SESSION_POLICY_RELATIVE_PATH = join("relay", "session-policy.yaml");

export async function loadRegistry(cwd: string): Promise<Registry> {
  const content = await readFile(join(cwd, REGISTRY_RELATIVE_PATH), "utf8");
  return RegistrySchema.parse(parseYaml(content));
}

export async function loadSessionPolicy(cwd: string): Promise<SessionPolicy> {
  const content = await readFile(join(cwd, SESSION_POLICY_RELATIVE_PATH), "utf8");
  return SessionPolicySchema.parse(parseYaml(content));
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
