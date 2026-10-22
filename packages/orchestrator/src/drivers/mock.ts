import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessEvent } from "@relay/schema";
import { HarnessEventEmitter } from "../events.js";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";

const MOCK_MARKER = ".relay-mock-run.txt";

function now(): string {
  return new Date().toISOString();
}

/** Deterministic harness driver for CI — no subprocess, emits typed events. */
export class MockHarnessDriver implements HarnessDriver {
  readonly kind = "mock" as const;

  private readonly emitter = new HarnessEventEmitter();
  private cancelFn: (() => void) | null = null;

  streamEvents(handler: (event: HarnessEvent) => void): () => void {
    return this.emitter.on(handler);
  }

  cancel(): void {
    this.cancelFn?.();
  }

  private emit(request: DriverRequest, event: HarnessEvent): void {
    this.emitter.emit(event);
    request.onEvent?.(event);
  }

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    let cancelled = false;
    this.cancelFn = () => {
      cancelled = true;
    };

    if (request.signal?.aborted || cancelled) {
      this.cancelFn = null;
      return { ok: false, harness: request.harness, summary: "Cancelled." };
    }

    const onAbort = () => {
      cancelled = true;
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const writesFiles =
      request.task.toLowerCase().includes("implement") ||
      request.task.toLowerCase().includes("fix") ||
      !request.task.toLowerCase().includes("test");

    this.emit(request, { type: "agent_start", at: now(), harness: request.harness });
    request.onLine?.("mock harness running…");

    if (cancelled) {
      request.signal?.removeEventListener("abort", onAbort);
      this.cancelFn = null;
      return { ok: false, harness: request.harness, summary: "Cancelled." };
    }

    const toolId = "mock-tool-1";
    this.emit(request, {
      type: "tool_start",
      at: now(),
      toolName: "write",
      toolCallId: toolId,
      args: { path: MOCK_MARKER },
    });
    request.onLine?.("▶ write  .relay-mock-run.txt");

    const lowerTask = request.task.toLowerCase();
    await mkdir(join(request.cwd, ".relay"), { recursive: true }).catch(() => undefined);
    let touchedPath = MOCK_MARKER;
    let content = `mock: ${request.task}\n`;
    if (lowerTask.includes("hello.sh") && lowerTask.includes("hello")) {
      touchedPath = "hello.sh";
      content = "#!/usr/bin/env bash\necho hello\n";
    } else if (lowerTask.includes("add.py") && lowerTask.includes("a+b")) {
      touchedPath = "add.py";
      content = "def add(a, b):\n    return a + b\n";
    } else if (lowerTask.includes("fib.py") && lowerTask.includes("fib")) {
      touchedPath = "fib.py";
      content = [
        "def fib(n):",
        "    if n < 2:",
        "        return n",
        "    a, b = 0, 1",
        "    for _ in range(2, n + 1):",
        "        a, b = b, a + b",
        "    return b",
        "",
      ].join("\n");
    }
    await writeFile(join(request.cwd, touchedPath), content, "utf8");

    this.emit(request, {
      type: "tool_end",
      at: now(),
      toolName: "write",
      toolCallId: toolId,
      ok: true,
      output: `wrote ${touchedPath}`,
    });
    request.onLine?.("✓ write");

    this.emit(request, { type: "agent_end", at: now(), harness: request.harness });
    request.signal?.removeEventListener("abort", onAbort);
    this.cancelFn = null;

    return {
      ok: true,
      harness: request.harness,
      summary: "Mock harness completed.",
      output: `Completed: ${request.task}`,
      toolCallCount: 1,
      ...(writesFiles ? { filesTouched: [touchedPath] } : {}),
    };
  }
}

export function isMockDriverEnabled(): boolean {
  return process.env.RELAY_MOCK_DRIVER === "1" || process.env.RELAY_MOCK_DRIVER === "true";
}
