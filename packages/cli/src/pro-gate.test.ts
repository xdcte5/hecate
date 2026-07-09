import { describe, expect, it } from "vitest";
import { gateProFeature } from "./pro-gate.js";

describe("gateProFeature", () => {
  it("does nothing when feature flag is off", () => {
    expect(() => gateProFeature("test", false)).not.toThrow();
  });
});
