import { describe, expect, it } from "vitest";
import { classifyLine, formatTranscriptEntry, parseOrchestratorLine } from "./transcript.js";

describe("transcript", () => {
  it("classifies plan lines", () => {
    expect(classifyLine("Plan (2 steps, 1 wave(s)):")).toBe("plan");
    expect(classifyLine("  Wave 0:")).toBe("plan");
    expect(classifyLine("    • Pi (ability-match) — build login")).toBe("plan");
  });

  it("classifies tool and agent lines", () => {
    expect(classifyLine("tool ▶ read")).toBe("tool");
    expect(classifyLine("▶ Step 1/2: Pi running…")).toBe("agent");
    expect(classifyLine("  ✗ Pi failed")).toBe("error");
    expect(classifyLine("  ✓ Pi finished.")).toBe("success");
  });

  it("formats entries with relay-branded prefixes", () => {
    const entry = parseOrchestratorLine("tool ▶ bash");
    const rendered = formatTranscriptEntry(entry);
    expect(rendered).toContain("tool");
    expect(rendered).toContain("bash");
  });
});
