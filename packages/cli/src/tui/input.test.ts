import { describe, expect, it } from "vitest";
import { parseInputCommand } from "./input.js";

describe("parseInputCommand", () => {
  it("parses relay shorthand commands", () => {
    expect(parseInputCommand("build")).toEqual({ kind: "relay", args: ["build", "--all"] });
    expect(parseInputCommand("launch")).toEqual({ kind: "relay", args: ["run", "--launch"] });
    expect(parseInputCommand("done")).toEqual({ kind: "relay", args: ["run", "--complete"] });
    expect(parseInputCommand("next")).toEqual({ kind: "relay", args: ["run", "--next"] });
  });

  it("treats natural language as an orchestrated run goal", () => {
    expect(parseInputCommand("add user login page")).toEqual({
      kind: "run",
      goal: "add user login page",
    });
    expect(parseInputCommand("create login page")).toEqual({
      kind: "run",
      goal: "create login page",
    });
  });

  it("returns null for empty input", () => {
    expect(parseInputCommand("")).toBeNull();
    expect(parseInputCommand("   ")).toBeNull();
  });
});
