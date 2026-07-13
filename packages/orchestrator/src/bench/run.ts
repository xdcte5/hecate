import { loadRelayConfig } from "@relay/registry";
import type { HarnessId, Registry } from "@relay/schema";
import { resolveHarnessBinary } from "../resolve-binary.js";
import { runHarnessAuto } from "../auto-run.js";
import { processPrompt } from "../process-prompt.js";
import { runVerifyCommand } from "../verify.js";
import { diffSnapshot, snapshotDir, type DirSnapshot } from "./fs-snapshot.js";
import {
  buildReport,
  computeSavings,
  estimateCost,
  estimateTokens,
  parseReportedTokens,
} from "./metrics.js";
import type {
  BenchMode,
  BenchReport,
  BenchSpec,
  BenchTask,
  RunMetrics,
  RunObservation,
  TaskComparison,
} from "./types.js";

/** A runner's raw observation; may override the measured wall time (used by the simulator). */
export type RunnerObservation = RunObservation & { wallMsOverride?: number };

export interface BenchContext {
  workspace: string;
  registry: Registry;
  baselineHarness: HarnessId;
  enabledAgents?: HarnessId[];
  signal?: AbortSignal;
}

export interface BenchRunners {
  baseline(task: BenchTask, ctx: BenchContext): Promise<RunnerObservation>;
  hecate(task: BenchTask, ctx: BenchContext): Promise<RunnerObservation>;
}

export interface RunBenchmarkOptions {
  /** Directory holding the relay config (registry + policy). */
  cwd: string;
  spec: BenchSpec;
  runners?: BenchRunners;
  enabledAgents?: HarnessId[];
  /** Where each (task, mode) run executes; defaults to `cwd`. */
  workspaceFor?: (task: BenchTask, mode: BenchMode) => string;
  /** Snapshot files before/after to count changes (default true). */
  snapshotFiles?: boolean;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

/** Run every task in both modes and produce a comparison report. */
export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchReport> {
  const { cwd, spec } = options;
  const snapshotFiles = options.snapshotFiles ?? true;
  const runners = options.runners ?? defaultRunners();
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const baselineHarness = spec.baseline ?? sessionPolicy.failover[0]!;
  const emit = options.onLine ?? (() => {});

  const comparisons: TaskComparison[] = [];
  for (const task of spec.tasks) {
    emit(`▶ ${task.id}: ${task.goal}`);
    const baseline = await runOne("baseline", task, {
      cwd,
      spec,
      registry,
      baselineHarness,
      runners,
      enabledAgents: options.enabledAgents,
      snapshotFiles,
      signal: options.signal,
      workspaceFor: options.workspaceFor,
    });
    emit(`  baseline: ${fmt(baseline)}`);
    const hecate = await runOne("hecate", task, {
      cwd,
      spec,
      registry,
      baselineHarness,
      runners,
      enabledAgents: options.enabledAgents,
      snapshotFiles,
      signal: options.signal,
      workspaceFor: options.workspaceFor,
    });
    emit(`  hecate:   ${fmt(hecate)}`);

    comparisons.push({
      taskId: task.id,
      goal: task.goal,
      baseline,
      hecate,
      savings: computeSavings(baseline, hecate),
    });
  }

  return buildReport(comparisons);
}

interface RunOneCtx {
  cwd: string;
  spec: BenchSpec;
  registry: Registry;
  baselineHarness: HarnessId;
  runners: BenchRunners;
  enabledAgents?: HarnessId[];
  snapshotFiles: boolean;
  signal?: AbortSignal;
  workspaceFor?: (task: BenchTask, mode: BenchMode) => string;
}

async function runOne(mode: BenchMode, task: BenchTask, ctx: RunOneCtx): Promise<RunMetrics> {
  const workspace = ctx.workspaceFor?.(task, mode) ?? ctx.cwd;
  const before: DirSnapshot = ctx.snapshotFiles ? await snapshotDir(workspace) : new Map();

  const started = Date.now();
  const obs = await ctx.runners[mode](task, {
    workspace,
    registry: ctx.registry,
    baselineHarness: ctx.baselineHarness,
    enabledAgents: ctx.enabledAgents,
    signal: ctx.signal,
  });
  const wallMs = obs.wallMsOverride ?? Date.now() - started;

  const after: DirSnapshot = ctx.snapshotFiles ? await snapshotDir(workspace) : new Map();
  const changedFiles = ctx.snapshotFiles ? diffSnapshot(before, after) : [];

  let verifyPassed: boolean | undefined;
  if (task.verify) {
    verifyPassed = (await runVerifyCommand(workspace, task.verify)).ok;
  }

  const estimatedTokens = estimateTokens(obs.outputChars, obs.reportedTokens);
  return {
    mode,
    ok: obs.ok,
    agentInvocations: obs.agentInvocations,
    plannerCalls: obs.plannerCalls,
    outputChars: obs.outputChars,
    reportedTokens: obs.reportedTokens,
    lines: obs.lines,
    wallMs,
    filesChanged: changedFiles.length,
    changedFiles,
    verifyPassed,
    estimatedTokens,
    estimatedCostUsd: estimateCost(estimatedTokens, ctx.spec.costPer1kTokens),
    humanInterventions: 0,
  };
}

/** Real runners: baseline = one harness on the whole goal; hecate = orchestrated multi-agent run. */
export function defaultRunners(): BenchRunners {
  return {
    async baseline(task, ctx) {
      const binary = await resolveHarnessBinary(ctx.registry, ctx.baselineHarness);
      if (!binary) {
        return { ok: false, agentInvocations: 0, plannerCalls: 0, outputChars: 0, lines: [`baseline harness ${ctx.baselineHarness} not installed`] };
      }
      const lines: string[] = [];
      const res = await runHarnessAuto({
        cwd: ctx.workspace,
        harness: ctx.baselineHarness,
        binary,
        task: task.goal,
        handoffPath: "",
        promptOverride: `Task: ${task.goal}\nApply the changes directly and run any checks yourself.`,
        timeoutMs: 10 * 60_000,
        signal: ctx.signal,
        onOutput: (l) => lines.push(l),
      });
      const captured = res.stdout ?? lines.join("\n");
      return {
        ok: res.ok,
        agentInvocations: 1,
        plannerCalls: 0,
        outputChars: captured.length,
        reportedTokens: parseReportedTokens(lines),
        lines,
      };
    },

    async hecate(task, ctx) {
      const lines: string[] = [];
      const res = await processPrompt(ctx.workspace, task.goal, {
        enabledAgents: ctx.enabledAgents,
        signal: ctx.signal,
        onLine: (l) => lines.push(l),
      });
      const stepRuns = lines.filter((l) => /▶ Step \d+\/\d+/.test(l)).length;
      const plannerCalls = lines.some((l) => /^Planner:.*structured plan/i.test(l)) ? 1 : 0;
      const isChat = lines.some((l) => /^Intent: chat/i.test(l));
      const agentInvocations = isChat ? 1 : plannerCalls + stepRuns;
      return {
        ok: res.ok,
        agentInvocations,
        plannerCalls,
        outputChars: lines.join("\n").length,
        reportedTokens: parseReportedTokens(lines),
        lines,
      };
    },
  };
}

/**
 * Deterministic runners for `--simulate`: exercise the full pipeline and report
 * without spawning agents or spending tokens. Numbers are illustrative — Hecate
 * reuses context across steps, so it models fewer tokens but more calls.
 */
export function simulateRunners(): BenchRunners {
  return {
    async baseline(task) {
      const outputChars = 2000 + task.goal.length * 40;
      return {
        ok: true,
        agentInvocations: 1,
        plannerCalls: 0,
        outputChars,
        lines: [`[sim] baseline ran "${task.id}" as one agent`],
        wallMsOverride: 42_000,
      };
    },
    async hecate(task) {
      const steps = 3;
      const outputChars = 1000 + task.goal.length * 22;
      return {
        ok: true,
        agentInvocations: steps + 1,
        plannerCalls: 1,
        outputChars,
        lines: [`[sim] hecate ran "${task.id}" via ${steps} routed steps + 1 planner`],
        wallMsOverride: 29_000,
      };
    },
  };
}

function fmt(m: RunMetrics): string {
  return `${(m.wallMs / 1000).toFixed(1)}s · ${m.agentInvocations} calls · ~${m.estimatedTokens} tok · ${m.filesChanged} files${m.verifyPassed === undefined ? "" : ` · verify ${m.verifyPassed ? "pass" : "fail"}`}`;
}
