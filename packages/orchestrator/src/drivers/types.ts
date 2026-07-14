import type { HarnessId, HarnessResult, HarnessEvent } from "@relay/schema";
import type { SelectHarnessReason } from "@relay/registry";
import type { SteerQueue } from "../steer-queue.js";

export type HarnessRunResult = HarnessResult & {
  /** Raw assistant output or stderr captured by the driver. */
  output?: string;
};

export type DriverEventHandler = (event: HarnessEvent) => void;

export type DriverRequest = {
  cwd: string;
  harness: HarnessId;
  binary: string;
  task: string;
  handoffPath: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Follow-up messages while the driver is running (Pi steer RPC). */
  steerQueue?: SteerQueue;
  /** Formatted string lines for terminal output. */
  onLine?: (line: string) => void;
  /** Typed harness events from the driver. */
  onEvent?: (event: HarnessEvent) => void;
  /** Optional active skill name (`/skill:review`). */
  activeSkill?: string;
};

export interface HarnessDriver {
  readonly kind: "pi-rpc" | "cli" | "mock";
  run(request: DriverRequest): Promise<HarnessRunResult>;
  /** Cancel an in-flight run (no-op when idle). */
  cancel(): void;
  /** Subscribe to typed events from the active run. */
  streamEvents(handler: DriverEventHandler): () => void;
}

export type PlannedStep = {
  id: string;
  task: string;
  harness: HarnessId;
  reason: SelectHarnessReason;
  wave: number;
};
