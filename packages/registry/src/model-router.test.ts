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

  it("routes unit tests to o4-mini on codex", () => {
    expect(routeModel("write unit tests for auth module", "codex", registry)).toMatchObject({
      modelId: "o4-mini",
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
