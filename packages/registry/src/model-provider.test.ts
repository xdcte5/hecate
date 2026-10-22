import { describe, expect, it } from "vitest";
import { isModelProviderAvailable } from "./model-provider.js";

describe("isModelProviderAvailable", () => {
  it("fails closed for unknown providers when auth set is non-empty", () => {
    expect(isModelProviderAvailable("azure-openai-responses/gpt-4", new Set(["openai-codex"]))).toBe(
      false,
    );
  });

  it("allows openai-codex listed models when openai-codex is authed", () => {
    expect(isModelProviderAvailable("openai-codex/gpt-5.4", new Set(["openai-codex"]))).toBe(true);
  });
});
