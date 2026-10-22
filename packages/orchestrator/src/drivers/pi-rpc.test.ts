import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeJsonLine } from "./jsonl.js";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockListChangedFiles = vi.hoisted(() => vi.fn());
const mockInstallMcpHarnessConfigs = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

vi.mock("../verify.js", () => ({
  listChangedFiles: mockListChangedFiles,
}));

vi.mock("@relay/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/adapters")>();
  return {
    ...actual,
    installMcpHarnessConfigs: mockInstallMcpHarnessConfigs,
  };
});

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

async function respondToSessionStats(
  child: MockChild,
  stdinChunks: string[],
  data: Record<string, unknown> = {},
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const statsCmd = stdinChunks
      .map((chunk) => {
        try {
          return JSON.parse(chunk) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((command) => command?.type === "get_session_stats");
    if (statsCmd) {
      emitLine(child, {
        id: statsCmd.id,
        type: "response",
        command: "get_session_stats",
        success: true,
        data: {
          tokens: { input: 100, output: 40, total: 140 },
          cost: 0.0012,
          ...data,
        },
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("get_session_stats command was not written");
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
    mockInstallMcpHarnessConfigs.mockResolvedValue({ targets: [], serverCount: 0 });
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
        usage: {
          input: 100,
          output: 40,
          cost: { total: 0.0012 },
        },
      },
    });
    emitLine(child, { type: "agent_settled" });
    await respondToSessionStats(child, stdinChunks);

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: true,
      harness: "pi",
      summary: "Pi finished.",
      toolCallCount: 1,
      filesTouched: ["README.md"],
      inputTokens: 100,
      outputTokens: 40,
      costUsd: 0.0012,
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
      "usage",
      "agent_end",
      "usage",
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
    await respondToSessionStats(child, stdinChunks, {
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
    });

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
    await respondToSessionStats(child, stdinChunks);

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
    await respondToSessionStats(child, stdinChunks);

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: false,
      summary: "boom",
    });
  });

  it("prefers get_session_stats usage over summed message_end totals", async () => {
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest());

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, {
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 10, output: 5, cost: { total: 0.0001 } },
      },
    });
    emitLine(child, { type: "agent_settled" });
    await respondToSessionStats(child, stdinChunks, {
      tokens: { input: 500, output: 200, total: 700 },
      cost: 0.05,
    });

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: true,
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.05,
    });
  });

  it("falls back to message_end usage when get_session_stats fails", async () => {
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest());

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, {
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 80, output: 20, cost: { total: 0.002 } },
      },
    });
    emitLine(child, { type: "agent_settled" });

    for (let i = 0; i < 50; i++) {
      const statsCmd = stdinChunks
        .map((chunk) => {
          try {
            return JSON.parse(chunk) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((command) => command?.type === "get_session_stats");
      if (statsCmd) {
        emitLine(child, {
          id: statsCmd.id,
          type: "response",
          command: "get_session_stats",
          success: false,
          error: "stats unavailable",
        });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const result = await runPromise;

    expect(result).toMatchObject({
      ok: true,
      inputTokens: 80,
      outputTokens: 20,
      costUsd: 0.002,
    });
  });

  it("auto-installs MCP configs when relay/mcp.json exists", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const cwd = mkdtempSync(join(tmpdir(), "relay-pi-mcp-"));
    mkdirSync(join(cwd, "relay"), { recursive: true });
    writeFileSync(join(cwd, "relay/mcp.json"), '{"mcpServers":{}}');

    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(baseRequest({ cwd }));

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, { type: "agent_settled" });
    await respondToSessionStats(child, stdinChunks);

    await runPromise;

    expect(mockInstallMcpHarnessConfigs).toHaveBeenCalledWith(cwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("warns but continues when MCP auto-install fails", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const cwd = mkdtempSync(join(tmpdir(), "relay-pi-mcp-fail-"));
    mkdirSync(join(cwd, "relay"), { recursive: true });
    writeFileSync(join(cwd, "relay/mcp.json"), '{"mcpServers":{}}');
    mockInstallMcpHarnessConfigs.mockRejectedValueOnce(new Error("disk full"));

    const lines: string[] = [];
    const promptId = "relay-1";
    const runPromise = new PiRpcDriver().run(
      baseRequest({ cwd, onLine: (line) => lines.push(line) }),
    );

    emitLine(child, { id: promptId, type: "response", command: "prompt", success: true });
    emitLine(child, { type: "agent_settled" });
    await respondToSessionStats(child, stdinChunks);

    const result = await runPromise;

    expect(result.ok).toBe(true);
    expect(lines.some((line) => line.includes("MCP auto-install failed"))).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
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
