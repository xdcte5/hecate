import { runHarnessAuto } from "../auto-run.js";
import { HarnessEventEmitter } from "../events.js";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";

/** Generic CLI fallback when no harness-specific driver exists. */
export class CliDriver implements HarnessDriver {
  readonly kind = "cli" as const;

  private readonly emitter = new HarnessEventEmitter();
  private cancelFn: (() => void) | null = null;

  streamEvents(handler: (event: import("@relay/schema").HarnessEvent) => void): () => void {
    return this.emitter.on(handler);
  }

  cancel(): void {
    this.cancelFn?.();
  }

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    const controller = new AbortController();
    this.cancelFn = () => controller.abort();
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });

    const result = await runHarnessAuto({
      cwd: request.cwd,
      harness: request.harness,
      binary: request.binary,
      task: request.task,
      handoffPath: request.handoffPath,
      model: request.model,
      timeoutMs: request.timeoutMs,
      signal: controller.signal,
      onOutput: request.onLine,
    });

    request.signal?.removeEventListener("abort", onExternalAbort);
    this.cancelFn = null;

    return {
      ok: result.ok,
      harness: request.harness,
      summary: result.summary,
      output: result.output,
    };
  }
}
