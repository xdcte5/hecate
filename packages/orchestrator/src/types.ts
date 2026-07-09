import type { HarnessId } from "@relay/schema";
import type { RouteModelReason, SelectHarnessReason } from "@relay/registry";

export type RunStepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "manual";

export type RunStep = {
  id: string;
  task: string;
  harness: HarnessId;
  reason: SelectHarnessReason;
  model?: string;
  modelReason?: RouteModelReason;
  wave: number;
  status: RunStepStatus;
  binary?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type RunState = {
  version: 1;
  goal: string;
  sessionId: string;
  steps: RunStep[];
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type RunPlan = {
  goal: string;
  steps: Array<
    Pick<RunStep, "id" | "task" | "harness" | "reason" | "model" | "modelReason" | "wave">
  >;
};

export type LaunchMode = "dry-run" | "launch" | "clipboard";

export type StepResult = {
  step: RunStep;
  launched: boolean;
  message: string;
};

export type RunResult = {
  state: RunState;
  results: StepResult[];
  message: string;
};
