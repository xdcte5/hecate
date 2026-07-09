import type { HarnessId } from "@relay/schema";
import type { SelectHarnessReason } from "@relay/registry";

export type HarnessRunResult = {
  ok: boolean;
  harness: HarnessId;
  summary: string;
  output?: string;
  filesTouched?: string[];
};

export type DriverRequest = {
  cwd: string;
  harness: HarnessId;
  binary: string;
  task: string;
  handoffPath: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (line: string) => void;
};

export interface HarnessDriver {
  readonly kind: "pi-rpc" | "cli";
  run(request: DriverRequest): Promise<HarnessRunResult>;
}

export type PlannedStep = {
  id: string;
  task: string;
  harness: HarnessId;
  reason: SelectHarnessReason;
  wave: number;
};
