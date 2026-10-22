# RouterBench → Relay Mapping Notes

Concise research notes linking [RouterBench](https://arxiv.org/abs/2403.08597) concepts and audit-trail patterns to Relay routing (Sprint 2 Track 2.1) and mini-bench validation (task 2.4).

---

## RouterBench → Relay

| RouterBench concept | Relay equivalent | Notes |
|---------------------|------------------|-------|
| **AIQ / cost–quality plane** | Mini-bench deferral validation (task 2.4) | RouterBench plots model ability vs $/query; Relay validates priors on the host micro-bench (`jobs/mini-bench/host-micro/`) before trusting deferral to cheaper harnesses. See [`docs/benchmark-comparison.md`](../benchmark-comparison.md). |
| **WTP λ** (willingness-to-pay) | `routing_config.blend.cost` | Higher λ → prefer cheaper experts when quality is close. Tune via [`relay/session-policy.yaml`](../../relay/session-policy.yaml) `blend.cost` (default `0.15`). |
| **Oracle router** (cheapest correct expert) | Relay routing goal | Ideal: pick the lowest-cost harness that completes + verifies. Approximated by blended score + eligibility preflight, not full oracle (would need perfect success prediction). |
| **Predictive score `λ·P − cost`** | Blended-router formula | RouterBench ranks by quality minus cost penalty; Relay uses weighted sum: `w_local·local + w_bench·bench + w_heur·heur + w_cost·cost` in `packages/registry/src/blended-router.ts`. Cost term is inverted median `costUsd` from `.relay/routing-stats.jsonl`. |

### Deferral validation loop (task 2.4)

1. Seed priors in [`relay/routing-priors.yaml`](../../relay/routing-priors.yaml).
2. Run host micro-bench; record outcomes to `.relay/routing-stats.jsonl`.
3. Compare blended picks vs single-agent baselines (pass rate, latency, cost).
4. Adjust `blend.*` weights and priors when deferral saves cost without quality loss.

---

## Audit trail: 5 decision-trace components → Relay events

Inspired by enterprise AI audit frameworks (e.g. miniOrange decision-trace articles): every routing decision should be reconstructable from five components.

| Trace component | What it captures | Relay source |
|-----------------|------------------|--------------|
| **1. Trigger** | What initiated the decision | `events.jsonl`: `session_started`, `handoff_prepared`; harness stream: `step_start`, `plan` |
| **2. Reasoning** | Why this harness/model | `decision_recorded` (text + rationale); plan step `routeReason` / `routeBreakdown`; routing reason (`routing-rule`, `blended`, `failover`) |
| **3. Tool calls** | Actions taken to decide or execute | Harness stream: `tool_start` / `tool_end`; MCP `session_record_decision` |
| **4. Context** | Inputs and state at decision time | RHP (`decisions`, `todos`, goal); handoff bundle; active `session-policy.yaml`; priors + local stats snapshot at route time |
| **5. Output** | Result of the decision | `step_end` (ok, summary); `handoff_prepared` (target harness); `.relay/routing-stats.jsonl` outcome row (`ok`, `verifyOk`, `costUsd`, `failoverReason`) |

### Inspecting traces

```bash
relay trace [session-id]     # events.jsonl timeline
relay doctor --routing       # current policy + route preview
```

Harness events (`plan`, `step_start`, `tool_*`) stream during `harbor-exec` / TUI runs; session lifecycle events persist to `.relay/sessions/<id>/events.jsonl`.

### Gap (Pro / future)

- Tier 3 (`--smart`) planner reasoning not yet persisted as structured trace fields.
- OTel export (`relay trace --otel`) planned for Pro cross-system audit correlation.

---

## Key files

| File | Role |
|------|------|
| [`relay/session-policy.yaml`](../../relay/session-policy.yaml) | Tier 1 rules, blend weights, step prefer |
| [`relay/routing-priors.yaml`](../../relay/routing-priors.yaml) | Tier 2 benchmark priors |
| `packages/registry/src/blended-router.ts` | Tier 2 scoring implementation |
| `packages/orchestrator/src/harness-eligibility.ts` | Tier 1 preflight |
| `docs/thin-router.md` | Hybrid 60/30/10 architecture |
