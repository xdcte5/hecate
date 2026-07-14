import { describe, expect, it } from "vitest";
import { parsePiListModels, selectPiListedModel } from "./pi-models.js";

describe("pi-models", () => {
  it("parses pi --list-models output", () => {
    const stdout = `provider      model
openai-codex  gpt-5.4
openai-codex  gpt-5.4-mini
groq          llama-3.1-8b-instant`;

    expect(parsePiListModels(stdout)).toEqual([
      { provider: "openai-codex", modelId: "gpt-5.4", spec: "openai-codex/gpt-5.4" },
      { provider: "openai-codex", modelId: "gpt-5.4-mini", spec: "openai-codex/gpt-5.4-mini" },
      { provider: "groq", modelId: "llama-3.1-8b-instant", spec: "groq/llama-3.1-8b-instant" },
    ]);
  });

  it("prefers gpt-5.4 on openai-codex for implement tasks", () => {
    const listed = parsePiListModels(`provider model
openai-codex gpt-5.4-mini
openai-codex gpt-5.4`);
    expect(selectPiListedModel(listed, "build a website")?.spec).toBe("openai-codex/gpt-5.4");
  });
});
