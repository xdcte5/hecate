/** Normalized provider id inferred from a model spec or registry model id. */
export type ModelProviderId = string;

/** Infer the LLM provider backing a Pi spec (`provider/model`) or registry model id. */
export function inferModelProvider(specOrId: string): ModelProviderId {
  const trimmed = specOrId.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.includes("/")) {
    return trimmed.split("/")[0]!;
  }

  if (/\b(claude|anthropic|sonnet|opus)\b/.test(trimmed)) return "anthropic";
  if (/\b(gpt|o[34]|codex|chatgpt)\b/.test(trimmed)) return "openai";
  if (/\b(gemini|google)\b/.test(trimmed)) return "google";
  if (/\b(mistral)\b/.test(trimmed)) return "mistral";
  if (/\b(github|copilot)\b/.test(trimmed)) return "github";
  if (/\b(openrouter)\b/.test(trimmed)) return "openrouter";

  return trimmed;
}

/**
 * Whether a model can run given authenticated Pi providers.
 * When auth is non-empty, unknown providers fail closed.
 */
export function isModelProviderAvailable(
  specOrId: string,
  authProviders: Set<string>,
): boolean {
  if (authProviders.size === 0) return true;

  const provider = inferModelProvider(specOrId);
  if (!provider) return false;
  if (authProviders.has(provider)) return true;

  for (const authed of authProviders) {
    const normalized = authed.toLowerCase();
    if (provider === normalized) return true;
    if (provider.startsWith(`${normalized}-`) || normalized.startsWith(`${provider}-`)) {
      return true;
    }
  }

  return false;
}
