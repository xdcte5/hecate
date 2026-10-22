import { describe, expect, it } from "vitest";
import type { HarnessId } from "@relay/schema";
import {
  applyStepRoutingPrefer,
  filterCandidatesByPrefer,
  pickByHarnessOrder,
  resolveHarnessOrder,
} from "./step-routing-order.js";

describe("resolveHarnessOrder", () => {
  it("puts prefer list before global failover", () => {
    const failover = ["pi", "cursor", "codex", "claude-code"] satisfies HarnessId[];
    const prefer = ["claude-code", "codex"] satisfies HarnessId[];

    expect(resolveHarnessOrder(prefer, failover)).toEqual([
      "claude-code",
      "codex",
      "pi",
      "cursor",
    ]);
  });
});

describe("filterCandidatesByPrefer", () => {
  it("restricts candidates to the prefer list", () => {
    const candidates = [
      { id: "pi", blended: 1 },
      { id: "claude-code", blended: 1 },
    ];

    expect(
      filterCandidatesByPrefer(
        candidates,
        ["claude-code"],
        ["pi", "claude-code", "codex"],
      ),
    ).toEqual([{ id: "claude-code", blended: 1 }]);
  });
});

describe("pickByHarnessOrder", () => {
  it("breaks ties using prefer order instead of global failover", () => {
    const candidates = [
      { id: "pi", blended: 0.5 },
      { id: "claude-code", blended: 0.5 },
    ];

    expect(
      pickByHarnessOrder(candidates, ["claude-code", "pi"], 0.5)?.id,
    ).toBe("claude-code");
  });
});

describe("applyStepRoutingPrefer", () => {
  it("keeps router pick when it is already preferred", () => {
    expect(
      applyStepRoutingPrefer(
        "codex",
        ["codex", "claude-code"],
        ["pi", "codex", "claude-code"],
      ),
    ).toBe("codex");
  });

  it("overrides to first preferred harness when router pick is outside prefer list", () => {
    expect(
      applyStepRoutingPrefer(
        "pi",
        ["claude-code"],
        ["pi", "cursor", "codex", "claude-code"],
      ),
    ).toBe("claude-code");
  });
});
