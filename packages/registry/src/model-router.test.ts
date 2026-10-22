import { describe, expect, it } from "vitest";
import type { Registry } from "@relay/schema";
import { routeModel } from "./model-router.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: ["architecture", "refactoring"],
      weaknesses: [],
      binaries: ["claude"],
      models: [
        { id: "claude-sonnet-4-6", strengths: ["frontend", "implementation", "reasoning"], weaknesses: [] },
        { id: "claude-opus-4-6", strengths: ["architecture", "refactoring", "complex reasoning"], weaknesses: [] },
      ],
    },
    {
      id: "codex",
      strengths: ["unit tests"],
      weaknesses: [],
      binaries: ["codex"],
      models: [
        { id: "o4-mini", strengths: ["unit tests", "test generation"], weaknesses: [] },
        { id: "o3", strengths: ["api design", "reasoning", "backend"], weaknesses: [] },
      ],
    },
    {
      id: "cursor",
      strengths: ["frontend"],
      weaknesses: [],
      binaries: ["cursor-agent"],
      models: [
        { id: "composer-2", strengths: ["react", "frontend", "portfolio", "ui", "graph"], weaknesses: [] },
        { id: "gpt-5.3-codex", strengths: ["implementation", "backend"], weaknesses: [] },
      ],
    },
    {
      id: "pi",
      strengths: ["scripts"],
      weaknesses: [],
      binaries: ["pi"],
      models: [
        { id: "claude-sonnet-4-6", strengths: ["implementation", "greenfield"], weaknesses: [] },
        { id: "gpt-4o", strengths: ["scripts", "automation", "cli", "shell"], weaknesses: [] },
      ],
    },
  ],
};

describe("routeModel", () => {
  it("routes portfolio frontend work to composer-2 on cursor", () => {
    expect(
      routeModel("build a portfolio page with graph ui showing socials", "cursor", registry),
    ).toMatchObject({
      modelId: "composer-2",
      reason: "ability-match",
    });
  });

  it("routes refactor tasks to claude-opus on claude-code", () => {
    expect(routeModel("refactor payment service boundaries", "claude-code", registry)).toMatchObject({
      modelId: "claude-opus-4-6",
      reason: "ability-match",
    });
  });

  it("defers codex automatic model selection to the local CLI default", () => {
    expect(routeModel("write unit tests for auth module", "codex", registry)).toMatchObject({
      modelId: undefined,
      reason: "ability-match",
    });
  });

  it("routes shell automation to gpt-4o on pi", () => {
    expect(routeModel("create shell script for nightly backups", "pi", registry)).toMatchObject({
      modelId: "gpt-4o",
      reason: "ability-match",
    });
  });

  it("falls back to the first configured model when no abilities match", () => {
    expect(routeModel("do something vague", "cursor", registry)).toMatchObject({
      modelId: "composer-2",
      reason: "default",
      score: 0,
    });
  });

  it("does not force stale codex capable-tier model ids", () => {
    expect(routeModel("review code quality", "codex", registry, { modelTier: "capable" })).toMatchObject({
      modelId: undefined,
      reason: "default",
      score: 0,
    });
  });

  it("routes capable tier to the strongest registry model on claude-code", () => {
    expect(routeModel("review the changes", "claude-code", registry, { modelTier: "capable" })).toMatchObject({
      modelId: "claude-opus-4-6",
      reason: "default",
      score: 0,
    });
  });

  it("skips mini Pi models when capable tier is requested", () => {
    expect(
      routeModel("review authentication module", "pi", registry, {
        modelTier: "capable",
        piListedModels: [
          { provider: "openai-codex", modelId: "gpt-5.4-mini", spec: "openai-codex/gpt-5.4-mini" },
          { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
        ],
      }),
    ).toMatchObject({
      modelId: "openai-codex/gpt-5.4",
      reason: "auth-match",
    });
  });

  it("picks an OpenAI Pi model when only openai is authenticated", () => {
    expect(
      routeModel("build a thrift shopping website", "pi", registry, {
        piAuthProviders: new Set(["openai"]),
      }),
    ).toMatchObject({
      modelId: "gpt-4o",
      reason: "auth-match",
    });
  });

  it("keeps ability routing within authenticated Pi providers", () => {
    expect(
      routeModel("create shell script for nightly backups", "pi", registry, {
        piAuthProviders: new Set(["openai", "anthropic"]),
      }),
    ).toMatchObject({
      modelId: "gpt-4o",
      reason: "ability-match",
    });
  });

  it("uses pi --list-models entries when provided", () => {
    expect(
      routeModel("build a thrift shopping website", "pi", registry, {
        piListedModels: [
          { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
          { provider: "groq", modelId: "llama-3.1-8b-instant", spec: "groq/llama-3.1-8b-instant" },
        ],
      }),
    ).toMatchObject({
      modelId: "openai-codex/gpt-5.4",
      reason: "auth-match",
    });
  });

  it("does not pick unauthenticated listed Pi models when auth filter is empty", () => {
    expect(
      routeModel("build a thrift shopping website", "pi", registry, {
        piAuthProviders: new Set(["openai-codex"]),
        piListedModels: [
          {
            provider: "azure-openai-responses",
            modelId: "gpt-4",
            spec: "azure-openai-responses/gpt-4",
          },
        ],
      }).modelId,
    ).not.toBe("azure-openai-responses/gpt-4");
  });

  it("returns undefined when harness has no models configured", () => {
    const bare: Registry = {
      harnesses: [
        {
          id: "pi",
          strengths: ["scripts"],
          weaknesses: [],
          binaries: ["pi"],
        },
      ],
    };

    expect(routeModel("create shell script", "pi", bare)).toEqual({
      modelId: undefined,
      reason: "default",
      score: 0,
    });
  });
});
