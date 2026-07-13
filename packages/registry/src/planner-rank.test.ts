import { describe, expect, it } from "vitest";
import type { Registry } from "@relay/schema";
import { rankPlanners, selectPrimaryPlanner, selectConversationalist } from "./planner-rank.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      planning: 9,
      conversation: 8,
      strengths: [],
      weaknesses: [],
      binaries: ["claude"],
      models: [
        { id: "claude-opus-4-6", planning: 10, conversation: 8, strengths: [], weaknesses: [] },
        { id: "claude-sonnet-4-6", planning: 7, conversation: 8, strengths: [], weaknesses: [] },
      ],
    },
    {
      id: "cursor",
      planning: 4,
      conversation: 4,
      strengths: [],
      weaknesses: [],
      binaries: ["cursor-agent"],
    },
    {
      id: "pi",
      planning: 6,
      conversation: 6,
      strengths: [],
      weaknesses: [],
      binaries: ["pi"],
    },
  ],
};

describe("planner hierarchy", () => {
  it("ranks claude-code first and names its strongest planning model", () => {
    const ranked = rankPlanners(registry);
    expect(ranked[0]!.harness).toBe("claude-code");
    expect(ranked[0]!.model).toBe("claude-opus-4-6");
    expect(ranked.map((r) => r.harness)).toEqual(["claude-code", "pi", "cursor"]);
  });

  it("selects the best available planner given a restricted set", () => {
    const primary = selectPrimaryPlanner(registry, ["pi", "cursor"]);
    expect(primary?.harness).toBe("pi");
  });

  it("returns null when no available harness can plan", () => {
    const bare: Registry = {
      harnesses: [{ id: "cursor", strengths: [], weaknesses: [], binaries: ["cursor-agent"] }],
    };
    expect(selectPrimaryPlanner(bare)).toBeNull();
  });

  it("selects the best conversationalist", () => {
    const conv = selectConversationalist(registry);
    expect(conv?.harness).toBe("claude-code");
  });
});
