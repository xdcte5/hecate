import { describe, expect, it } from "vitest";
import { RoutingPriorsSchema, type RoutingPriors } from "./routing-priors.js";

const fixture: RoutingPriors = {
  version: "1",
  updated: "2026-07-14",
  sources: ["web-extracted"],
  task_types: {
    implement: {
      "codex/o4-mini": 0.82,
      "pi/openai-codex/gpt-5.4": 0.8,
      "cursor/composer-2": 0.74,
      "claude-code/claude-sonnet-4-6": 0.68,
    },
    fix: {
      "claude-code/claude-opus-4-6": 0.9,
      "cursor/composer-2": 0.75,
    },
  },
  signal_adjustments: [
    { signal: "frontend", adjustment: 0.08, target: "cursor" },
    { signal: "test", adjustment: 0.1, target: "codex/o4-mini" },
    { signal: "script", adjustment: 0.08, target: "pi" },
  ],
};

describe("RoutingPriorsSchema", () => {
  it("parses a full routing priors document", () => {
    expect(RoutingPriorsSchema.parse(fixture)).toEqual(fixture);
  });

  it("parses a minimal priors document", () => {
    const minimal = { version: "1", task_types: {} };
    expect(RoutingPriorsSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects scores outside 0-1 range", () => {
    expect(() =>
      RoutingPriorsSchema.parse({
        version: "1",
        task_types: { implement: { "codex/o4-mini": 1.5 } },
      }),
    ).toThrow();
  });

  it("rejects negative scores", () => {
    expect(() =>
      RoutingPriorsSchema.parse({
        version: "1",
        task_types: { implement: { "codex/o4-mini": -0.1 } },
      }),
    ).toThrow();
  });
});
