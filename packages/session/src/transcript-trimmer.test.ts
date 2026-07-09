import { describe, it, expect } from "vitest";
import {
  dedupeTranscriptLines,
  estimateTokenCount,
  trimTranscriptLines,
} from "./transcript-trimmer.js";

describe("estimateTokenCount", () => {
  it("uses chars divided by four", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
    expect(estimateTokenCount("a".repeat(100))).toBe(25);
  });
});

describe("dedupeTranscriptLines", () => {
  it("removes consecutive duplicate lines", () => {
    const lines = ['{"a":1}', '{"a":1}', '{"b":2}', '{"b":2}', '{"b":2}'];
    expect(dedupeTranscriptLines(lines)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("keeps non-consecutive duplicate lines", () => {
    const lines = ['{"a":1}', '{"b":2}', '{"a":1}'];
    expect(dedupeTranscriptLines(lines)).toEqual(lines);
  });
});

describe("trimTranscriptLines", () => {
  const lines = ["line-1", "line-2", "line-3", "line-4", "line-5"];

  it("returns all lines when no limits are provided", () => {
    expect(trimTranscriptLines(lines)).toEqual(lines);
  });

  it("keeps only the last N lines with maxLines", () => {
    expect(trimTranscriptLines(lines, { maxLines: 2 })).toEqual(["line-4", "line-5"]);
  });

  it("drops lines from the front until maxChars is satisfied", () => {
    const result = trimTranscriptLines(lines, { maxChars: 12 });
    expect(result.join("\n").length).toBeLessThanOrEqual(12);
    expect(result[result.length - 1]).toBe("line-5");
  });

  it("applies maxLines before maxChars", () => {
    const lines = ["drop-1", "drop-2", "keep-3", "keep-4"];
    const result = trimTranscriptLines(lines, { maxLines: 2, maxChars: 100 });
    expect(result).toEqual(["keep-3", "keep-4"]);
  });

  it("drops oldest lines when maxChars is exceeded", () => {
    const lines = ["aaaa", "bbbb", "cccc"];
    const result = trimTranscriptLines(lines, { maxChars: 9 });
    expect(result).toEqual(["bbbb", "cccc"]);
  });
});
