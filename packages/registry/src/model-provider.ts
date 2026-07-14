/** Map registry / Pi model ids to the LLM provider they require. */
export type ModelProviderId = "anthropic" | "openai" | "google" | "github" | "mistral" | "openrouter";

export function inferModelProvider(modelId: string): ModelProviderId | undefined {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || /^o\d/.test(id) || id.includes("codex") || id.includes("chatgpt")) {
    return "openai";
  }
  if (id.startsWith("gemini")) return "google";
  if (id.includes("copilot") || id.includes("github")) return "github";
  if (id.startsWith("mistral")) return "mistral";
  return undefined;
}

export function isModelProviderAvailable(
  modelId: string,
  available: Set<string>,
): boolean {
  if (available.size === 0) return true;

  const providerFromSpec = modelId.includes("/") ? modelId.split("/")[0] : undefined;
  const provider = providerFromSpec ?? inferModelProvider(modelId);
  if (!provider) return true;

  if (available.has(provider)) return true;
  if (provider === "openai-codex" && available.has("openai")) return true;
  if (provider.includes("openai") && available.has("openai-codex")) return true;
  if (provider.includes("openai") && [...available].some((id) => id.includes("openai"))) {
    return true;
  }
  return false;
}
