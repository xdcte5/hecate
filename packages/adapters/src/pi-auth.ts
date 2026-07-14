import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Normalized LLM provider ids discovered from Pi auth / env. */
export type PiProviderId = "anthropic" | "openai" | "google" | "github" | "mistral" | "openrouter";

const ENV_PROVIDER_KEYS: Array<{ env: string; provider: PiProviderId }> = [
  { env: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { env: "OPENAI_API_KEY", provider: "openai" },
  { env: "GOOGLE_API_KEY", provider: "google" },
  { env: "GEMINI_API_KEY", provider: "google" },
  { env: "MISTRAL_API_KEY", provider: "mistral" },
];

function normalizeProviderKey(key: string): PiProviderId | string {
  const k = key.toLowerCase();
  if (k.includes("anthropic") || k === "claude") return "anthropic";
  if (k.includes("openai-codex") || k === "codex") return "openai-codex";
  if (k.includes("openai") || k.includes("chatgpt") || k === "gpt") {
    return "openai";
  }
  if (k.includes("google") || k.includes("gemini")) return "google";
  if (k.includes("github") || k.includes("copilot")) return "github";
  if (k.includes("mistral")) return "mistral";
  if (k.includes("openrouter")) return "openrouter";
  return k;
}

function providerKeysFromAuthObject(auth: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(auth)) {
    if (key === "credentials" && value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...Object.keys(value as Record<string, unknown>));
      continue;
    }
    if (key === "providers" && value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...Object.keys(value as Record<string, unknown>));
      continue;
    }
    if (value && typeof value === "object") {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Detect which Pi LLM providers are authenticated locally (OAuth in ~/.pi/agent/auth.json
 * and/or API keys in the environment). Values are never read or logged.
 */
export async function detectPiAuthProviders(
  home = process.env.HOME ?? process.env.USERPROFILE,
): Promise<Set<PiProviderId | string>> {
  const providers = new Set<PiProviderId | string>();

  for (const { env, provider } of ENV_PROVIDER_KEYS) {
    if (process.env[env]?.trim()) providers.add(provider);
  }

  if (!home) return providers;

  try {
    const raw = await readFile(join(home, ".pi/agent/auth.json"), "utf8");
    const auth = JSON.parse(raw) as Record<string, unknown>;
    for (const key of providerKeysFromAuthObject(auth)) {
      providers.add(normalizeProviderKey(key));
    }
  } catch {
    // Pi not configured or auth unreadable
  }

  return providers;
}
