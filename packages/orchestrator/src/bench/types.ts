import type { HarnessId } from "@relay/schema";

export interface BenchTask {
  id: string;
  goal: string;
  /** Optional shell command that gates success (exit 0 = pass), run after each mode. */
  verify?: string;
}

export interface BenchSpec {
  tasks: BenchTask[];
  /** Harness for the single-agent baseline (default: first failover harness). */
  baseline?: HarnessId;
  /** USD per 1k output tokens; a `default` key enables cost estimates. */
  costPer1kTokens?: Record<string, number>;
}

export type BenchMode = "baseline" | "hecate";

/** What a runner reports about a single execution, before timing/fs metrics are added. */
export interface RunObservation {
  ok: boolean;
  /** Agent/model invocations: planner + step runs for hecate, 1 for baseline. */
  agentInvocations: number;
  plannerCalls: number;
  /** Characters of captured agent output (a token proxy when real usage is absent). */
  outputChars: number;
  /** Real token count if the harness reported it in its output. */
  reportedTokens?: number;
  lines: string[];
}

export interface RunMetrics extends RunObservation {
  mode: BenchMode;
  wallMs: number;
  filesChanged: number;
  changedFiles: string[];
  verifyPassed?: boolean;
  estimatedTokens: number;
  estimatedCostUsd?: number;
  /** Manual hand-offs required; 0 for autonomous runs, kept for parity with the metric matrix. */
  humanInterventions: number;
}

export interface BenchSavings {
  /** Positive = Hecate faster / fewer. */
  wallPct: number;
  tokenPct: number;
  invocationsDelta: number;
}

export interface TaskComparison {
  taskId: string;
  goal: string;
  baseline: RunMetrics;
  hecate: RunMetrics;
  savings: BenchSavings;
}

export interface AggregateMetrics {
  runs: number;
  okRuns: number;
  wallMs: number;
  agentInvocations: number;
  estimatedTokens: number;
  estimatedCostUsd?: number;
  filesChanged: number;
  verifyPassed: number;
}

export interface BenchReport {
  createdAt: string;
  tasks: TaskComparison[];
  totals: {
    baseline: AggregateMetrics;
    hecate: AggregateMetrics;
    savings: BenchSavings;
  };
}
