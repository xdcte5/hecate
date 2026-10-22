# Relay Graph Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase V2 graph verifier execution behind `RELAY_GRAPH=1`.

**Architecture:** Keep `execute-plan.ts` as the worker owner. Add a focused `graph/` package that runs verifier nodes in parallel, synthesizes to the existing `GateVerdict`, and lets the existing verify retry loop handle failures.

**Tech Stack:** TypeScript, Vitest, existing `VerifierSpec`, `VerifierResult`, `GateVerdict`, existing Relay event schema.

## Global Constraints

- `RELAY_GRAPH` default off; default V1 verifier behavior is unchanged.
- No new dependencies.
- Graph verifier code reuses `packages/orchestrator/src/verifiers/`.
- Full `pnpm test` must pass before completion.
- Do not commit unless explicitly asked.

---

### Task 1: Graph Types And Synthesizer

**Files:**
- Create: `packages/orchestrator/src/graph/types.ts`
- Create: `packages/orchestrator/src/graph/synthesizer.ts`
- Create: `packages/orchestrator/src/graph/index.ts`
- Test: `packages/orchestrator/src/graph/synthesizer.test.ts`

**Interfaces:**
- Consumes: `VerifierSpec`, `VerifierResult`, `GateVerdict`.
- Produces: `GraphNode`, `GraphNodeResult`, `GraphExecutionResult`, `synthesizeVerifierResults(results, durationMs)`.

- [ ] Write failing synthesizer tests for all-pass, one-fail, and empty result sets.
- [ ] Run `pnpm --filter @relay/orchestrator test -- --run src/graph/synthesizer.test.ts` and confirm RED.
- [ ] Implement graph types and synthesizer.
- [ ] Rerun the targeted test and confirm GREEN.

### Task 2: Parallel Graph Executor

**Files:**
- Create: `packages/orchestrator/src/graph/executor.ts`
- Test: `packages/orchestrator/src/graph/executor.test.ts`

**Interfaces:**
- Consumes: `runVerifierSpec(spec, cwd, options)` exported from verifier composition.
- Produces: `runVerifierGraph(step, cwd, options): Promise<GraphExecutionResult>`.

- [ ] Write failing executor tests proving verifier specs run concurrently, verifier failures synthesize to BLOCK, and thrown verifier errors become failed node results.
- [ ] Run targeted graph executor test and confirm RED.
- [ ] Implement executor with `Promise.all`.
- [ ] Rerun targeted executor test and confirm GREEN.

### Task 3: Execute Plan Graph Wiring

**Files:**
- Modify: `packages/orchestrator/src/execute-plan.ts`
- Test: `packages/orchestrator/src/execute-plan.graph.test.ts`

**Interfaces:**
- Consumes: `runVerifierGraph`.
- Produces: `RELAY_GRAPH=1` path that emits graph-node events, emits final `verify_outcome`, and reuses existing verify retry loop.

- [ ] Write failing execute-plan graph test with a verifier failing once, then passing.
- [ ] Run targeted test and confirm RED.
- [ ] Wire `execute-plan.ts` to choose graph verification when `process.env.RELAY_GRAPH === "1"`.
- [ ] Rerun targeted test and confirm GREEN.

### Task 4: Trace Surface And Production Verification

**Files:**
- Modify: `packages/schema/src/harness-event.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/orchestrator/src/events.ts`
- Modify: `packages/cli/src/tui/transcript.ts`
- Modify tests near these files as needed.

**Interfaces:**
- Produces: typed graph node events visible in text/TUI trace surfaces.

- [ ] Add failing event/transcript tests for graph node events.
- [ ] Implement event schema and formatters.
- [ ] Run targeted package tests.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm test`.
- [ ] Run a Relay micro-bench smoke with `RELAY_GRAPH=1` for A/B/C or explain any external auth blocker.
