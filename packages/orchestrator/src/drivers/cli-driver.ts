import { runHarnessAuto } from "../auto-run.js";
import type { HarnessDriver, DriverRequest, HarnessRunResult } from "./types.js";

export class CliDriver implements HarnessDriver {
  readonly kind = "cli" as const;

  async run(request: DriverRequest): Promise<HarnessRunResult> {
    const result = await runHarnessAuto({
      cwd: request.cwd,
      harness: request.harness,
      binary: request.binary,
      task: request.task,
      handoffPath: request.handoffPath,
      model: request.model,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      onOutput: request.onEvent,
    });

    return {
      ok: result.ok,
      harness: request.harness,
      summary: result.summary,
      output: result.output,
    };
  }
}
