import type { HarnessId, Registry } from "@relay/schema";
import { resolveHarnessBinary } from "./resolve-binary.js";
import { runHarnessAuto } from "./auto-run.js";

export interface RunRawOptions {
  cwd: string;
  harness: HarnessId;
  registry: Registry;
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onOutput?: (line: string) => void;
}

/**
 * Run a harness once with an exact prompt (no autonomous handoff preamble) and
 * return its full stdout. Used for the planning "spy" pass and conversational
 * answers. Returns null when the harness binary is missing or the run fails.
 */
export async function runRawPrompt(options: RunRawOptions): Promise<string | null> {
  const binary = await resolveHarnessBinary(options.registry, options.harness);
  if (!binary) return null;

  const result = await runHarnessAuto({
    cwd: options.cwd,
    harness: options.harness,
    binary,
    task: options.prompt,
    handoffPath: "",
    promptOverride: options.prompt,
    model: options.model,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
    onOutput: options.onOutput,
  });

  if (!result.ok) return null;
  const text = result.stdout ?? result.output ?? "";
  return text.trim().length > 0 ? text : null;
}
