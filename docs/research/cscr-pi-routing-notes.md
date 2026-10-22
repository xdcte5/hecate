# CSCR + Pi RPC → Relay Blended Router

Research notes mapping **Cost-Aware Contrastive Routing (CSCR)** ([arXiv:2508.12491](https://arxiv.org/abs/2508.12491)) and Pi RPC `get_session_stats` to Relay's blended router and usage capture pipeline.

---

## CSCR paper (summary)

CSCR routes prompts across a dynamic pool of LLM experts by learning a **contrastive encoder** that places queries and expert fingerprints in a shared metric space. Training uses **cost-spectrum contrastive routing**:

- Experts are grouped into **5 adaptive cost bands** (cheapest → most expensive).
- Within each band, the objective favors the **cheapest accurate expert** (not global cheapest-only collapse).
- **Negative cost penalty (γ):** expensive wrong experts increase the partition function, so the encoder is pushed to separate from them first — a soft penalty on high-cost failures.
- **Inference (Eq. 9 simplified):** pick expert minimizing `cosine_distance(query, expert) + λ × normalized_cost` — quality and cost in one score, with λ controlling the accuracy–cost tradeoff.
- **Band-specific temperature (τ_k):** higher-cost bands use flatter softmax to avoid collapsing onto a single rare positive when training data is sparse.

CSCR achieves up to ~25% better accuracy–cost tradeoff vs baselines and generalizes to unseen models without retraining (FAISS k-NN at inference).

---

## Relay blended-router mapping

Relay does **not** train a contrastive encoder. Instead it uses deterministic signals from project history and harness cards — a pragmatic OSS approximation of CSCR's inference objective.

| CSCR concept | Relay equivalent |
|--------------|------------------|
| `argmin(cos_sim + λ × cost)` | Weighted blend: local + benchmark + heuristic + cost |
| 5 cost bands | `model_tier: capable` for review steps; step-type routing (`implement` / `test` / `review`) |
| γ penalty on expensive wrong experts | Local stats down-rank harnesses with high median cost + low success (`routing-stats.jsonl`) |
| Deferral / accuracy–cost curve | Benchmark `$ / successful step`, not latency alone |
| Don't collapse to cheapest only | `blend.cost: 0.15` — cost influences, doesn't dominate |

### Default blend weights (session-policy)

After rebalancing to include cost:

```
route_score = 0.425 × local_success
            + 0.2125 × benchmark_prior
            + 0.2125 × heuristic_match
            + 0.15   × (1 − norm_median_cost)
```

Implemented in `packages/registry/src/blended-router.ts`:

- **local** — success rate from `.relay/routing-stats.jsonl` (per task type × harness)
- **benchmark** — priors from `relay/routing-priors.yaml`
- **heuristic** — Harness Card strengths vs detected task signals
- **cost** — inverted normalized median `costUsd` per (taskType, harness); weight redistributed when no cost samples exist (`effectiveBlendWeights`)

Schema defaults live in `packages/schema/src/session-policy.ts` (`RoutingBlendSchema`).

---

## Pi RPC `get_session_stats`

Per Pi RPC docs, per-turn `message_end` usage can be incomplete or hard to aggregate across tool loops. Pi exposes **authoritative session totals** via:

```json
{"type": "get_session_stats"}
```

Response (`success: true`):

```json
{
  "type": "response",
  "command": "get_session_stats",
  "data": {
    "tokens": { "input": 50000, "output": 10000, "total": 105000 },
    "cost": 0.45,
    "contextUsage": { "tokens": 60000, "contextWindow": 200000, "percent": 30 }
  }
}
```

- `data.tokens` — assistant usage totals for the session state
- `data.cost` — session cost in USD
- `data.contextUsage` — live context window estimate (compaction / display); optional

### Relay driver behavior

In `packages/orchestrator/src/drivers/pi-rpc.ts`:

1. On `agent_settled`, send `get_session_stats` **before** finishing the harness run.
2. Parse via `parseUsageFromSessionStats()` in `streaming-cli.ts` — reads `data.tokens.input/output` and `data.cost`.
3. **Prefer session stats** over summed `message_end` usage when stats are available.
4. **Fallback** to accumulated `message_end` usage if stats RPC fails (does not fail the step).

Usage flows into `HarnessRunResult` → `buildOutcomeFromStep` → `.relay/routing-stats.jsonl`, feeding the **cost** component of the blended router.

---

## End-to-end loop

```
Pi step completes
  → get_session_stats (authoritative costUsd, tokens)
  → routing-stats.jsonl append
  → BlendedRouter reads median cost per harness
  → next step: cost term in blend (0.15 weight)
  → CSCR-style "capable expert within cost band" without ML training
```

---

## Follow-ups (not in scope)

- Full γ-style penalty as explicit score term (today: implicit via low local success + high cost)
- FrugalGPT-style cascade on verify failure (Sprint 4)
- Contrastive embedding / FAISS index for `--smart` Pro routing
- Plot deferral curves from mini-bench usage runs
