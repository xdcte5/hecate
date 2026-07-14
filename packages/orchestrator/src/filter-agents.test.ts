import { describe, expect, it } from "vitest";
import { filterEnabledAgents, syncEnabledAgentsWithInstalled } from "./filter-agents.js";

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

describe("syncEnabledAgentsWithInstalled", () => {
  const failover = ["pi", "cursor", "claude-code", "codex"] as const;

  it("returns failover order intersect installed when enabled list is empty", () => {
    expect(syncEnabledAgentsWithInstalled([], ["pi", "claude-code"], [...failover])).toEqual([
      "pi",
      "claude-code",
    ]);
  });

  it("adds newly installed agents from failover order", () => {
    expect(
      syncEnabledAgentsWithInstalled(["claude-code"], ["pi", "claude-code"], [...failover]),
    ).toEqual(["pi", "claude-code"]);
  });

  it("drops enabled agents whose CLIs are no longer installed", () => {
    expect(syncEnabledAgentsWithInstalled(["pi", "codex"], ["pi"], [...failover])).toEqual(["pi"]);
  });

  it("preserves failover ordering", () => {
    expect(
      syncEnabledAgentsWithInstalled(
        ["claude-code", "codex"],
        ["pi", "claude-code", "codex"],
        [...failover],
      ),
    ).toEqual(["pi", "claude-code", "codex"]);
  });
});
