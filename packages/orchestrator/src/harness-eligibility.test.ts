import { describe, expect, it } from "vitest";
import { filterRunnableHarnesses, isHarnessRunnable } from "./harness-eligibility.js";

describe("isHarnessRunnable", () => {
  it("excludes Pi when only azure models are listed and openai-codex is authed", () => {
    expect(
      isHarnessRunnable("pi", {
        installed: ["pi", "claude-code"],
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [
          {
            provider: "azure-openai-responses",
            modelId: "gpt-4",
            spec: "azure-openai-responses/gpt-4",
          },
        ],
      }),
    ).toBe(false);
  });

  it("includes claude-code when its binary is installed", () => {
    expect(isHarnessRunnable("claude-code", { installed: ["claude-code"] })).toBe(true);
  });

  it("includes codex and cursor when installed", () => {
    expect(isHarnessRunnable("codex", { installed: ["codex"] })).toBe(true);
    expect(isHarnessRunnable("cursor", { installed: ["cursor"] })).toBe(true);
  });

  it("includes Pi when a listed model matches an authenticated provider", () => {
    expect(
      isHarnessRunnable("pi", {
        installed: ["pi"],
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [
          { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
        ],
      }),
    ).toBe(true);
  });

  it("excludes Pi when binary is installed but no auth providers are configured", () => {
    expect(
      isHarnessRunnable("pi", {
        installed: ["pi"],
        piListedModels: [
          { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
        ],
      }),
    ).toBe(false);
  });

  it("excludes Pi when model discovery returns no models and no auth providers are configured", () => {
    expect(
      isHarnessRunnable("pi", {
        installed: ["pi"],
        piAuthProviders: new Set(),
        piListedModels: [],
      }),
    ).toBe(false);
  });

  it("excludes Pi when auth exists but no eligible model is discovered", () => {
    expect(
      isHarnessRunnable("pi", {
        installed: ["pi"],
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [],
      }),
    ).toBe(false);
  });
});

describe("filterRunnableHarnesses", () => {
  it("drops Pi from failover when auth preflight fails", () => {
    expect(
      filterRunnableHarnesses(["pi", "claude-code", "codex"], {
        installed: ["pi", "claude-code", "codex"],
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [
          {
            provider: "azure-openai-responses",
            modelId: "gpt-4",
            spec: "azure-openai-responses/gpt-4",
          },
        ],
      }),
    ).toEqual(["claude-code", "codex"]);
  });
});
