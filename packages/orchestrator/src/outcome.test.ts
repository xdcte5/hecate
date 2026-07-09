import { describe, expect, it } from "vitest";
import { hasDeferredApproval } from "./outcome.js";

describe("hasDeferredApproval", () => {
  it("detects approval-gated agent output", () => {
    expect(
      hasDeferredApproval("All four changes are queued and waiting on your approval"),
    ).toBe(true);
    expect(hasDeferredApproval("nothing has been written yet")).toBe(true);
    expect(hasDeferredApproval("wrote 3 files successfully")).toBe(false);
  });
});
