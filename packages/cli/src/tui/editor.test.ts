import { describe, expect, it } from "vitest";
import {
  EditorBuffer,
  detectEditorHint,
  editorPreview,
  formatEditorHint,
  parseEditorLine,
} from "./editor.js";

describe("EditorBuffer", () => {
  it("tracks multiline text", () => {
    const buffer = new EditorBuffer("line one").appendLine("line two");
    expect(buffer.text).toBe("line one\nline two");
    expect(buffer.isMultiline()).toBe(true);
  });
});

describe("detectEditorHint", () => {
  it("detects @file hints", () => {
    expect(detectEditorHint("please read @src/app")).toEqual({
      kind: "file",
      token: "src/app",
    });
  });

  it("detects !cmd hints", () => {
    expect(detectEditorHint("run !pnpm test")).toEqual({
      kind: "shell",
      token: "pnpm",
    });
  });

  it("returns null when no hint token", () => {
    expect(detectEditorHint("build login page")).toBeNull();
  });
});

describe("formatEditorHint", () => {
  it("formats file and shell hints", () => {
    expect(formatEditorHint({ kind: "file", token: "src/x.ts" })).toContain("src/x.ts");
    expect(formatEditorHint({ kind: "shell", token: "" })).toContain("shell command");
  });
});

describe("parseEditorLine", () => {
  it("continues on trailing backslash", () => {
    const first = parseEditorLine("first line\\");
    expect(first.action).toBe("continue");
    if (first.action !== "continue") return;

    const second = parseEditorLine("second line", first.buffer);
    expect(second).toEqual({ action: "submit", text: "first line\nsecond line" });
  });

  it("submits single-line input", () => {
    expect(parseEditorLine("build login page")).toEqual({
      action: "submit",
      text: "build login page",
    });
  });
});

describe("editorPreview", () => {
  it("summarizes multiline text", () => {
    expect(editorPreview("one\ntwo\nthree")).toBe("one … (+2 lines)");
  });
});
