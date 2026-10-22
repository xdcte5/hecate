import type { HarnessId, HarnessResult, StepRoutingRule } from "@relay/schema";
import type { RouteModelReason, SelectHarnessReason } from "@relay/registry";
import type { GateVerdict, VerifierSpec } from "./verifiers/types.js";

export type RunStepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "manual";

export type RouteBreakdown = {
  local?: number;
  benchmark?: number;
  heuristic?: number;
  winner?: string;
  scores?: Record<string, number>;
};

export type RunStep = {
  id: string;
  task: string;
  harness: HarnessId;
  reason: SelectHarnessReason;
  routeReason?: string;
  routeBreakdown?: RouteBreakdown;
  model?: string;
  modelReason?: RouteModelReason;
  modelTier?: StepRoutingRule["model_tier"];
  wave: number;
  status: RunStepStatus;
  binary?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: Partial<HarnessResult>;
  verify?: VerifierSpec[];
  verifyRetries?: number;
  verifyFeedback?: string;
  verifyFailureEvidence?: string[];
  lastVerifyVerdict?: GateVerdict;
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
    Pick<
      RunStep,
      | "id"
      | "task"
      | "harness"
      | "reason"
      | "routeReason"
      | "routeBreakdown"
      | "model"
      | "modelReason"
      | "modelTier"
      | "wave"
      | "verify"
    >
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
