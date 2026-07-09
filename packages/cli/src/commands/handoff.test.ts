import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatRoutingReason,
  parseHandoffTarget,
  resolveAutoHandoffTarget,
  rotateAwayFromCurrent,
} from "./handoff.js";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../fixtures/minimal-relay",
);

describe("parseHandoffTarget", () => {
  it("accepts auto", () => {
    expect(parseHandoffTarget("auto")).toBe("auto");
  });

  it("accepts explicit harness ids", () => {
    expect(parseHandoffTarget("cursor")).toBe("cursor");
    expect(parseHandoffTarget("codex")).toBe("codex");
  });

  it("rejects unknown targets", () => {
    expect(() => parseHandoffTarget("unknown")).toThrow(/Invalid harness/);
  });
});

describe("resolveAutoHandoffTarget", () => {
  it("routes fix React component to cursor for frontend+debug abilities", async () => {
    const { harness, routing } = await resolveAutoHandoffTarget(
      fixtureRoot,
      "fix React component",
    );

    expect(harness).toBe("cursor");
    expect(formatRoutingReason(routing)).toContain("ability-match");
  });

  it("routes write unit tests to codex", async () => {
    const { harness } = await resolveAutoHandoffTarget(fixtureRoot, "write unit tests");
    expect(harness).toBe("codex");
  });

  it("rotates away from the active harness on auto handoff", async () => {
    const { harness, rotated } = await resolveAutoHandoffTarget(
      fixtureRoot,
      "add user login page",
      "cursor",
    );

    expect(harness).toBe("claude-code");
    expect(rotated).toBe(true);
  });
});

describe("rotateAwayFromCurrent", () => {
  it("returns the next failover harness when already on the selected one", () => {
    expect(
      rotateAwayFromCurrent("cursor", "cursor", ["cursor", "claude-code", "codex", "pi"]),
    ).toBe("claude-code");
  });

  it("keeps explicit routing when it differs from current", () => {
    expect(
      rotateAwayFromCurrent("codex", "cursor", ["cursor", "claude-code", "codex", "pi"]),
    ).toBe("codex");
  });
});
