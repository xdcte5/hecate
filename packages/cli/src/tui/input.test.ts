import { describe, expect, it } from "vitest";
import {
  BUSY_BLOCK_MESSAGE,
  formatSteerAck,
  parseInputCommand,
  resolveTuiInput,
} from "./input.js";

describe("parseInputCommand", () => {
  it("parses relay shorthand commands", () => {
    expect(parseInputCommand("build")).toEqual({ kind: "relay", args: ["build", "--all"] });
    expect(parseInputCommand("launch")).toEqual({ kind: "relay", args: ["run", "--launch"] });
    expect(parseInputCommand("done")).toEqual({ kind: "relay", args: ["run", "--complete"] });
    expect(parseInputCommand("next")).toEqual({ kind: "relay", args: ["run", "--next"] });
  });

  it("parses slash commands", () => {
    expect(parseInputCommand("/status")).toEqual({ kind: "slash", command: "status" });
    expect(parseInputCommand("/agents")).toEqual({ kind: "slash", command: "agents" });
    expect(parseInputCommand("/steer add logout button")).toEqual({
      kind: "steer",
      message: "add logout button",
    });
    expect(parseInputCommand("/harness pi")).toEqual({ kind: "harness", harness: "pi" });
    expect(parseInputCommand("/model gpt-4o")).toEqual({ kind: "model", model: "gpt-4o" });
  });

  it("parses tui commands without treating them as goals", () => {
    expect(parseInputCommand("agents")).toEqual({ kind: "slash", command: "agents" });
    expect(parseInputCommand("models")).toEqual({ kind: "tui", command: "models" });
    expect(parseInputCommand("config")).toEqual({ kind: "tui", command: "config" });
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

describe("resolveTuiInput", () => {
  it("steers natural language while busy", () => {
    expect(resolveTuiInput("also add tests", { busy: true })).toEqual({
      type: "steer",
      message: "also add tests",
    });
  });

  it("blocks agents and models while busy", () => {
    expect(resolveTuiInput("agents", { busy: true })).toEqual({
      type: "busy-block",
      message: BUSY_BLOCK_MESSAGE,
    });
    expect(resolveTuiInput("/agents", { busy: true })).toEqual({
      type: "busy-block",
      message: BUSY_BLOCK_MESSAGE,
    });
    expect(resolveTuiInput("models", { busy: true })).toEqual({
      type: "busy-block",
      message: BUSY_BLOCK_MESSAGE,
    });
  });

  it("queues harness and model overrides while busy", () => {
    expect(resolveTuiInput("/harness pi", { busy: true })).toEqual({
      type: "harness",
      harness: "pi",
    });
    expect(resolveTuiInput("/model gpt-4o", { busy: true })).toEqual({
      type: "model",
      model: "gpt-4o",
    });
  });

  it("runs goals when idle", () => {
    expect(resolveTuiInput("build login page", { busy: false })).toEqual({
      type: "run",
      goal: "build login page",
    });
    expect(resolveTuiInput("agents", { busy: false })).toEqual({ type: "agents" });
  });
});

describe("formatSteerAck", () => {
  it("truncates long steer messages", () => {
    const long = "x".repeat(100);
    expect(formatSteerAck(long)).toContain("…");
  });
});
