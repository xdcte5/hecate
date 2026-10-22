export type ClaimVerdict = {
  claim: string;
  verdict: "SUPPORTED" | "REFUTED" | "UNVERIFIABLE";
  confidence: number;
  evidence: string;
};

export type VerifierSpec =
  | { type: "artifact"; path: string }
  | { type: "shell"; command: string; expectStdout?: string; expectExitCode?: number }
  | { type: "python"; code: string }
  | { type: "test-gate"; command?: string }
  | { type: "git-changed"; minFiles?: number };

export type VerifierStatus = "PASS" | "FAIL" | "SKIP";

export type VerifierResult = {
  verifierId: string;
  status: VerifierStatus;
  ok: boolean;
  confidence: number;
  evidence: string;
  durationMs: number;
};

export type GateVerdict = {
  ok: boolean;
  recommendation: "ACT" | "BLOCK" | "NEEDS_HUMAN";
  confidence: number;
  evidence: string;
  verifierId: string;
  durationMs: number;
  results: VerifierResult[];
  claims?: ClaimVerdict[];
};

export type VerifiableStep = {
  id: string;
  task: string;
  verify?: VerifierSpec[];
};
