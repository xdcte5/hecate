import { describe, expect, it } from "vitest";
import { filterEnabledAgents } from "./filter-agents.js";

describe("filterEnabledAgents", () => {
  it("returns full failover when no enabled list", () => {
    expect(filterEnabledAgents(["pi", "codex"], undefined)).toEqual(["pi", "codex"]);
  });

  it("filters failover to enabled agents", () => {
    expect(filterEnabledAgents(["pi", "cursor", "codex"], ["codex", "claude-code"])).toEqual([
      "codex",
      "claude-code",
    ]);
  });

  it("falls back to enabled list when none overlap failover", () => {
    expect(filterEnabledAgents(["pi"], ["codex"])).toEqual(["codex"]);
  });
});
