import { describe, expect, it } from "vitest";
import { inferModelProvider, isModelProviderAvailable } from "./model-provider.js";

describe("model-provider", () => {
  it("maps claude models to anthropic", () => {
    expect(inferModelProvider("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("maps gpt and o-series models to openai", () => {
    expect(inferModelProvider("gpt-4o")).toBe("openai");
    expect(inferModelProvider("o3")).toBe("openai");
  });

  it("filters unavailable providers", () => {
    expect(isModelProviderAvailable("claude-sonnet-4-6", new Set(["openai"]))).toBe(false);
    expect(isModelProviderAvailable("gpt-4o", new Set(["openai"]))).toBe(true);
  });
});
