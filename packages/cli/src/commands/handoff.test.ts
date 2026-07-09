import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatRoutingReason,
  parseHandoffTarget,
  resolveAutoHandoffTarget,
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
  it("routes fix React component to cursor", async () => {
    const { harness, routing } = await resolveAutoHandoffTarget(
      fixtureRoot,
      "fix React component",
    );

    expect(harness).toBe("cursor");
    expect(formatRoutingReason(routing)).toContain("routing-rule");
  });

  it("routes write unit tests to codex", async () => {
    const { harness } = await resolveAutoHandoffTarget(fixtureRoot, "write unit tests");
    expect(harness).toBe("codex");
  });
});
