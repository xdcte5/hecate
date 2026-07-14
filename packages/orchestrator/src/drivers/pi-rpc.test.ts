import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeJsonLine } from "./jsonl.js";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockListChangedFiles = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("../verify.js", () => ({
  listChangedFiles: mockListChangedFiles,
}));

vi.mock("../skills-bridge.js", () => ({
  loadRelaySkills: vi.fn().mockResolvedValue([]),
  formatSkillsCatalog: vi.fn().mockReturnValue(""),
  formatSkillPromptSection: vi.fn().mockReturnValue(""),
  buildPiSkillsEnv: vi.fn().mockReturnValue({}),
}));

import { formatHarnessEventLine } from "../events.js";
import { PiRpcDriver, sendAbort, sendSteer } from "./pi-rpc.js";
import type { DriverRequest } from "./types.js";

type MockChild = ChildProcess & {
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
};

function createMockChild(): MockChild {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as MockChild;
  child.stdout = stdout;
  child.stdin = stdin;
  child.stderr = stderr;
  child.kill = vi.fn();
  return child;
}

function emitLine(child: MockChild, value: unknown): void {
  child.stdout.write(serializeJsonLine(value));
}

async function waitForPrompt(stdinChunks: string[]): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (
      stdinChunks.some((chunk) => {
        try {
          return JSON.parse(chunk).type === "prompt";
        } catch {
          return false;
        }
      })
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("prompt command was not written");
}

function baseRequest(overrides: Partial<DriverRequest> = {}): DriverRequest {
  return {
    cwd: "/tmp/project",
    harness: "pi",
    binary: "pi",
    task: "add readme",
    handoffPath: "/tmp/handoff.md",
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("PiRpcDriver", () => {
  let child: MockChild;
  let stdinChunks: string[];

  beforeEach(() => {
    child = createMockChild();
    stdinChunks = [];
    child.stdin.on("data", (chunk) => {
      stdinChunks.push(String(chunk));
    });
    mockSpawn.mockReturnValue(child);
    mockListChangedFiles.mockResolvedValue(["README.md"]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes happy path with tool events and filesTouched", async () => {
    const lines: string[] = [];
    const events: Array<{ type: string }> = [];
    const promptId = "relay-1";

    const runPromise = new PiRpcDriver().run(
      baseRequest({
        onLine: (line) => lines.push(line),
        onEvent: (event) => {
          events.push(event);
          const line = formatHarnessEventLine(event);
          if (line) lines.push(line);
        },
      }),
    );

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, { type: "agent_start" });
    emitLine(child, {
      type: "tool_execution_start",
      toolCallId: "tc_1",
      toolName: "read",
      args: { path: "README.md" },
    });
    emitLine(child, {
      type: "tool_execution_end",
      toolCallId: "tc_1",
      toolName: "read",
      result: { content: [{ type: "text", text: "hello" }] },
      isError: false,
    });
    emitLine(child, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done updating README." }],
      },
    });
    emitLine(child, { type: "agent_settled" });

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: true,
      harness: "pi",
      summary: "Pi finished.",
      toolCallCount: 1,
      filesTouched: ["README.md"],
    });
    expect(lines).toEqual([
      "prompt accepted — agent running…",
      "agent started",
      "tool ▶ read",
      "tool ✓ read",
      "message (assistant)",
      "agent settled",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "tool_start",
      "tool_end",
      "agent_message",
      "agent_end",
    ]);
    expect(JSON.parse(stdinChunks[0]!)).toMatchObject({
      type: "prompt",
      message: expect.stringContaining("add readme"),
    });
  });

  it("fails when prompt response reports an error", async () => {
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest());

    emitLine(child, {
      id: promptId,
      type: "response",
      command: "prompt",
      success: false,
      error: "model unavailable",
    });

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: false,
      summary: "model unavailable",
    });
    expect(child.kill).toHaveBeenCalled();
  });

  it("emits tool events in execution order", async () => {
    const toolSequence: string[] = [];
    const promptId = "relay-1";

    const runPromise = new PiRpcDriver().run(
      baseRequest({
        onEvent: (event) => {
          if (event.type === "tool_start" || event.type === "tool_end") {
            toolSequence.push(`${event.type}:${event.toolName}`);
          }
        },
      }),
    );

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, { type: "tool_execution_start", toolCallId: "a", toolName: "read" });
    emitLine(child, { type: "tool_execution_end", toolCallId: "a", toolName: "read", isError: false });
    emitLine(child, { type: "tool_execution_start", toolCallId: "b", toolName: "write" });
    emitLine(child, { type: "tool_execution_end", toolCallId: "b", toolName: "write", isError: false });
    emitLine(child, { type: "agent_settled" });

    await runPromise;

    expect(toolSequence).toEqual([
      "tool_start:read",
      "tool_end:read",
      "tool_start:write",
      "tool_end:write",
    ]);
  });

  it("forwards steer queue messages to Pi RPC after prompt accepted", async () => {
    const { createSteerQueue } = await import("../steer-queue.js");
    const steerQueue = createSteerQueue();
    const promptId = "relay-1";

    const runPromise = new PiRpcDriver().run(baseRequest({ steerQueue }));

    await waitForPrompt(stdinChunks);
    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    steerQueue.enqueue("also add logout button");

    await new Promise((resolve) => setTimeout(resolve, 20));

    emitLine(child, { type: "agent_settled" });

    await runPromise;

    const steerCommand = stdinChunks
      .map((chunk) => JSON.parse(chunk))
      .find((command) => command.type === "steer");
    expect(steerCommand).toMatchObject({
      type: "steer",
      message: "also add logout button",
    });
  });

  it("cancels via abort signal and sends abort RPC when prompt was accepted", async () => {
    const controller = new AbortController();
    const promptId = "relay-1";

    const runPromise = new PiRpcDriver().run(
      baseRequest({ signal: controller.signal }),
    );

    await waitForPrompt(stdinChunks);
    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: false,
      summary: "Cancelled.",
    });
    expect(child.kill).toHaveBeenCalled();
    const abortCommand = stdinChunks
      .map((chunk) => JSON.parse(chunk))
      .find((command) => command.type === "abort");
    expect(abortCommand).toBeDefined();
  });

  it("fails on agent_settled when extension_error was received", async () => {
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest());

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, {
      type: "extension_error",
      extensionPath: "/ext/foo.ts",
      error: "boom",
    });
    emitLine(child, { type: "agent_settled" });

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: false,
      summary: "boom",
    });
  });

  it("does not treat early process exit as success", async () => {
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest({ timeoutMs: 60_000 }));

    await waitForPrompt(stdinChunks);
    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    child.emit("exit", 0);

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: false,
      summary: "Pi exited before agent settled (code 0)",
    });
  });
});

describe("Pi RPC command stubs", () => {
  it("sendAbort writes abort command", () => {
    const written: Record<string, unknown>[] = [];
    const id = sendAbort((body) => {
      written.push(body);
      return "relay-1";
    });
    expect(id).toBe("relay-1");
    expect(written[0]).toEqual({ type: "abort" });
  });

  it("sendSteer writes steer command with message", () => {
    const written: Record<string, unknown>[] = [];
    const id = sendSteer((body) => {
      written.push(body);
      return "relay-2";
    }, "focus on tests");
    expect(id).toBe("relay-2");
    expect(written[0]).toEqual({ type: "steer", message: "focus on tests" });
  });
});
