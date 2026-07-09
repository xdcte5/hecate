import { describe, expect, it } from "vitest";
import type { Registry } from "@relay/schema";
import { getRegistryModels } from "./model-picker.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: [],
      weaknesses: [],
      binaries: ["claude"],
      models: [{ id: "claude-sonnet-4-6", strengths: ["reasoning"], weaknesses: [] }],
    },
  ],
};

describe("model-picker", () => {
  it("reads model ids from registry cards", () => {
    expect(getRegistryModels(registry, "claude-code")).toEqual(["claude-sonnet-4-6"]);
    expect(getRegistryModels(registry, "codex")).toEqual([]);
  });
});
