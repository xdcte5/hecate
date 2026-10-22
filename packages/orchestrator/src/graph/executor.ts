import type { SessionPolicy } from "@relay/schema";
import { runVerifierSpec, writeVerifierEvidence } from "../verifiers/compose.js";
import type { VerifiableStep, VerifierResult, VerifierSpec } from "../verifiers/types.js";
import { synthesizeVerifierResults } from "./synthesizer.js";
import type { GraphExecutionOptions, GraphExecutionResult, GraphNode, GraphNodeResult } from "./types.js";

export type VerifierSpecRunner = (
  spec: VerifierSpec,
  cwd: string,
  sessionPolicy?: SessionPolicy,
) => Promise<VerifierResult>;

function elapsed(started: number): number {
  return Math.max(0, Date.now() - started);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function nodeIdForSpec(spec: VerifierSpec, index: number): string {
  switch (spec.type) {
    case "artifact":
      return `artifact-${slug(spec.path) || index}`;
    case "shell":
      return `shell-${slug(spec.command) || index}`;
    case "python":
      return `python-${slug(spec.code) || index}`;
    case "test-gate":
      return `test-gate-${slug(spec.command ?? "auto") || index}`;
    case "git-changed":
      return `git-changed-${spec.minFiles ?? 1}`;
  }
}

function nodesForStep(step: VerifiableStep): GraphNode[] {
  return (step.verify ?? []).map((spec, index) => ({
    id: nodeIdForSpec(spec, index),
    type: "verifier",
    spec,
  }));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runNode(
  node: GraphNode,
  cwd: string,
  options: GraphExecutionOptions & { runSpec: VerifierSpecRunner },
): Promise<GraphNodeResult> {
  const started = Date.now();
  if (!node.spec) {
    return {
      nodeId: node.id,
      nodeType: node.type,
      ok: true,
      evidence: "node has no verifier spec",
      durationMs: elapsed(started),
    };
  }

  try {
    const verifier = await options.runSpec(node.spec, cwd, options.sessionPolicy);
    const result: GraphNodeResult = {
      nodeId: node.id,
      nodeType: node.type,
      ok: verifier.ok,
      verifier,
      evidence: verifier.evidence,
      durationMs: elapsed(started),
    };
    options.onNodeResult?.(result);
    return result;
  } catch (error) {
    const verifier: VerifierResult = {
      verifierId: node.spec.type,
      status: "FAIL",
      ok: false,
      confidence: 0.5,
      evidence: `verifier threw: ${errorMessage(error)}`,
      durationMs: elapsed(started),
    };
    const result: GraphNodeResult = {
      nodeId: node.id,
      nodeType: node.type,
      ok: false,
      verifier,
      evidence: verifier.evidence,
      durationMs: verifier.durationMs,
    };
    options.onNodeResult?.(result);
    return result;
  }
}

export async function runVerifierGraph(
  step: VerifiableStep,
  cwd: string,
  options: GraphExecutionOptions & { runSpec?: VerifierSpecRunner } = {},
): Promise<GraphExecutionResult> {
  const started = Date.now();
  const nodes = nodesForStep(step);
  const runSpec = options.runSpec ?? runVerifierSpec;
  const nodeResults = await Promise.all(
    nodes.map((node) => runNode(node, cwd, { ...options, runSpec })),
  );
  const durationMs = elapsed(started);
  await writeVerifierEvidence(
    cwd,
    step.id,
    nodeResults.flatMap((result) => (result.verifier ? [result.verifier] : [])),
    options.sessionId,
  );

  return {
    step,
    nodes,
    nodeResults,
    verdict: synthesizeVerifierResults(nodeResults, durationMs),
    durationMs,
  };
}
