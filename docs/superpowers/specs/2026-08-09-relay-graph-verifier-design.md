# Relay Graph Verifier Design

## Goal

Build Phase V2 from `docs/codex-build-handoff-verifiers-and-graph.md`: a production-ready graph executor behind `RELAY_GRAPH=1` that runs verifier nodes in parallel after a worker step, synthesizes results into one gate verdict, and loops failed verification back to the worker retry path.

## Architecture

The default execution path remains the V1 linear verifier flow. When `RELAY_GRAPH=1` and a step has verifier specs, `execute-plan.ts` delegates verification to `packages/orchestrator/src/graph/`. The graph package is intentionally small:

- `types.ts` defines graph nodes, node results, execution options, and trace events.
- `synthesizer.ts` converts parallel verifier node results into the existing `GateVerdict` contract.
- `executor.ts` runs verifier nodes concurrently and returns a single gate verdict plus node-level results.
- `index.ts` exports the public graph API.

The graph runtime reuses the V1 deterministic verifiers. It does not spawn implementation agents itself; `execute-plan.ts` remains the worker loop owner and applies existing `suggestVerifyRetry()` / `applyVerifyRetry()` behavior.

## Data Flow

1. Worker returns success.
2. `execute-plan.ts` checks `RELAY_GRAPH=1`.
3. Graph executor maps each `VerifierSpec` to a verifier node and runs all nodes concurrently.
4. Synthesizer emits one `GateVerdict`.
5. `execute-plan.ts` emits `verify_outcome` and graph node events.
6. PASS marks the step done; FAIL uses the existing max-3 verifier retry loop.

## Error Handling

Verifier node exceptions become `FAIL` node results with evidence. A failed verifier never throws past the graph executor unless the process is aborted. Empty verifier graphs synthesize to ACT for compatibility with V1.

## Testing

Use TDD. Required tests:

- `graph/executor.test.ts`: fan-out, fail aggregation, exception conversion.
- `graph/synthesizer.test.ts`: PASS/FAIL synthesis and confidence behavior.
- `execute-plan.graph.test.ts`: `RELAY_GRAPH=1` uses graph verification and retries failed verification.
- CLI/trace tests for graph node visibility if existing trace surfaces typed harness events.

## Constraints

- No new runtime dependencies.
- `RELAY_GRAPH` default off.
- V1 behavior must remain unchanged when flag is absent.
- Full `pnpm test` must pass before reporting done.
- Do not commit unless explicitly asked.
