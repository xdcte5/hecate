import { describe, expect, it } from "vitest";
import {
  computeLayoutRegions,
  renderHeader,
  renderLayout,
  visibleTranscriptSlice,
} from "./layout.js";

describe("layout", () => {
  it("computes transcript region from terminal height", () => {
    const regions = computeLayoutRegions(24);
    expect(regions.headerRows).toBe(4);
    expect(regions.footerRows).toBe(1);
    expect(regions.inputRows).toBe(1);
    expect(regions.transcriptRows).toBe(16);
  });

  it("renders header with goal and relay branding", () => {
    const lines = renderHeader("build login page", 80);
    expect(lines.join("\n")).toContain("RELAY");
    expect(lines.join("\n")).toContain("build login page");
  });

  it("shows newest transcript lines at the bottom", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const { visible } = visibleTranscriptSlice(lines, 4, 0);
    expect(visible.filter(Boolean)).toEqual(["line 7", "line 8", "line 9", "line 10"]);
  });

  it("renders full layout with footer and input prompt", () => {
    const frame = renderLayout({
      goal: "demo",
      transcriptLines: ["agent › running"],
      footerLine: "relay harness Pi",
      inputPrompt: "you › ",
      scrollOffset: 0,
      width: 80,
      height: 20,
    });

    expect(frame).toContain("RELAY");
    expect(frame).toContain("agent › running");
    expect(frame).toContain("relay harness Pi");
    expect(frame).toContain("you › ");
  });
});
