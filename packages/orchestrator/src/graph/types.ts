import type { SessionPolicy } from "@relay/schema";
import type { VerifiableStep, VerifierResult, VerifierSpec } from "../verifiers/types.js";

export type GraphNodeType = "verifier" | "synthesizer";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  spec?: VerifierSpec;
};

export type GraphNodeResult = {
  nodeId: string;
  nodeType: GraphNodeType;
  ok: boolean;
  verifier?: VerifierResult;
  evidence?: string;
  durationMs: number;
};

export type GraphExecutionOptions = {
  sessionId?: string;
  sessionPolicy?: SessionPolicy;
  onNodeResult?: (result: GraphNodeResult) => void;
};

export type GraphExecutionResult = {
  step: VerifiableStep;
  nodes: GraphNode[];
  nodeResults: GraphNodeResult[];
  verdict: import("../verifiers/types.js").GateVerdict;
  durationMs: number;
};
