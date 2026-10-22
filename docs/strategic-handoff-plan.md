# Strategic Handoff & Failover Fix — Implementation Plan

**Goal:** Relay should be cheaper because it **decomposes work and compresses handoffs**, not because it always picks the cheapest model. Failover should be **rare and capability-driven**, not Pi auth failure on every run.

**Date:** 2026-07-15

---

## Problem statement

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Failover every run | Pi → claude-code on micro-tasks | Pi routed first; `azure-openai-responses` not authed; reactive retry |
| Slower than direct | Relay ~26–64s vs Claude ~18s | Failover tax + full handoff + multi-step plan on trivial goals |
| "Cheaper" for wrong reason | Relay $0.27 vs Claude $0.74 | Different models (Sonnet vs Opus), not strategic savings |
| No cost learning | Router ignores $/success | `routing-stats.jsonl` lacks token/cost fields |

---

## Design principles

1. **Right agent per requirement** — implement / test / review / debug get different harness+model policies.
2. **Handoff compresses context** — next agent gets decisions + diff + scoped task, not full re-read.
3. **Preflight before spawn** — never start an agent that cannot authenticate.
4. **Failover = capability gap** — auth/install failures re-route at plan time, not post-failure retry.
5. **Learn $/successful step** — routing stats feed blended router over time.

---

## Phase 1: Fix failover (parallel track A)

### 1.1 Auth-aware harness eligibility

**Files:** `packages/registry/src/model-provider.ts`, `packages/adapters/src/pi-auth.ts`, new `packages/orchestrator/src/harness-eligibility.ts`

- Add `isHarnessRunnable(harness, { installed, piAuth, piListedModels })`.
- Pi runnable only if ≥1 listed model matches an authenticated provider.
- Fix `routePiFromListedModels`: if auth filter yields **empty**, do **not** fall back to full list — return null → router picks next harness.
- Fix `isModelProviderAvailable`: when auth set non-empty, **fail closed** for unknown providers.

### 1.2 Plan-time failover filtering

**Files:** `packages/orchestrator/src/process-prompt.ts`, `packages/orchestrator/src/filter-agents.ts`

- After `syncEnabledAgentsWithInstalled`, filter failover to **runnable** harnesses only.
- If planned harness not runnable, swap to first runnable in failover order **before** execute (no wasted spawn).

### 1.3 Execute-time auth preflight

**Files:** `packages/orchestrator/src/execute-plan.ts`, `packages/orchestrator/src/replan.ts`

- Before `driver.run()`, validate harness+model auth.
- On auth failure: **instant reroute** to next runnable harness (same attempt budget, no Pi spawn).
- Distinguish `failoverReason: "auth" | "capability" | "verify"` in routing stats.

### 1.4 Tests

- `harness-eligibility.test.ts` — Pi excluded when only azure models listed, openai-codex authed.
- `routing-integration.test.ts` — plan does not select Pi when not runnable.
- `execute-plan` integration — no Pi spawn when preflight fails.

---

## Phase 2: Tiered handoffs (parallel track B)

### 2.1 Handoff tiers by step type

**Files:** `packages/session/src/rhp-builder.ts`, `packages/schema/src/rhp.ts` (if needed)

| Step type | Handoff includes | Excludes |
|-----------|------------------|----------|
| `implement` | goal, decisions, open TODOs | full git diff |
| `test` | goal, test command hint, changed files | full transcript |
| `review` | goal, decisions, **diff stat / changed paths** | unrelated files |
| `debug` | error snippet, last command | full HANDOFF history |

Add `buildHandoffArtifacts(session, to, git, { tier, stepId })`.

### 2.2 Apply `maxHandoffTokens`

**Files:** `packages/session/src/store.ts`, `packages/session/src/rhp-builder.ts`

- Load `governance.maxHandoffTokens` from session policy in `prepareHandoff`.
- Trim markdown sections (transcript, verbose git) to cap tokens.
- Pass tier from `execute-plan` when calling `prepareHandoff`.

### 2.3 Tests

- Handoff token count under cap for review tier.
- Test tier omits diff blobs.

---

## Phase 3: Strategic plan steps (parallel track C)

### 3.1 Requirement-aware plan template

**Files:** `packages/orchestrator/src/plan.ts`, `packages/orchestrator/src/goal-analysis.ts`

- Classify goal signals: `security`, `test`, `refactor`, `trivial` (single-file).
- **Trivial** → 1 step implement only (no test/review wave).
- **No test signal** → skip test step.
- **No security/refactor** → skip review step.
- Per-step `taskType` drives router + handoff tier.

### 3.2 Step-type harness policy (not cheapest-global)

**Files:** `relay/session-policy.yaml`, `packages/registry/src/blended-router.ts`

```yaml
step_routing:
  implement: { prefer: [claude-code, codex, pi] }
  test: { prefer: [codex, claude-code] }
  review: { prefer: [claude-code], model_tier: capable }
  debug: { prefer: [codex, pi] }
```

Router uses step type + prefer list before global failover.

### 3.3 Tests

- "create hello.sh" → 1 step plan.
- "add API + tests" → implement + test, no review.

---

## Phase 4: Cost/success routing stats (parallel track D)

### 4.1 Schema extension

**Files:** `packages/schema/src/routing-outcome.ts`

```ts
inputTokens?: number;
outputTokens?: number;
costUsd?: number;
failoverReason?: "auth" | "capability" | "verify" | "none";
```

### 4.2 Capture from drivers

**Files:** `packages/orchestrator/src/drivers/streaming-cli.ts`, `packages/orchestrator/src/drivers/pi-rpc.ts`, `packages/schema/src/harness-result.ts`

- Parse `type=result` / `turn.completed` when `RELAY_CAPTURE_USAGE=1` or always in non-prod.
- Attach usage to `HarnessRunResult`.
- Flow through `buildOutcomeFromStep`.

### 4.3 Router blend update (follow-up)

**Files:** `packages/registry/src/routing-stats-reader.ts`, `blended-router.ts`

- Compute median `costUsd` per (taskType, harness) where `ok && verifyOk`.
- Add `blend.cost` weight (default 0.15) after min samples.

---

## Parallel implementation tracks

| Track | Owner | Deliverables |
|-------|-------|--------------|
| **A** | Agent 1 | harness-eligibility, model-router fix, process-prompt filter, execute preflight, tests |
| **B** | Agent 2 | handoff tiers, maxHandoffTokens wired, prepareHandoff options, tests |
| **C** | Agent 3 | trivial goal detection, plan step pruning, step_routing policy schema, tests |
| **D** | Agent 4 | routing-outcome schema, HarnessResult usage, driver parsing, routing-stats wiring |

**Integration point (coordinator):** `execute-plan.ts` passes `stepType` + `handoffTier` to `prepareHandoff`; `process-prompt.ts` uses filtered failover from track A.

---

## Success metrics

| Metric | Before | Target |
|--------|--------|--------|
| Pi auth failover rate | ~100% on micro-bench | **0%** when Pi not authed |
| Steps per trivial task | 1–3 + retry | **1** |
| Handoff size (trivial) | Full git changed list | **< 2k tokens** |
| Relay latency (trivial) | ~26–64s | **≤ 1.2× direct Claude** |
| Cost per completed goal | Unmeasured | Tracked in routing-stats; strategic plan ≤ direct single-agent |

---

## Repro / verify

```bash
cd ~/Projects/sample-app
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; corepack enable
cd ~/Projects/relay && pnpm build && pnpm test

# Should NOT show Pi failover when only claude+codex authed
node packages/cli/dist/index.js doctor --routing
node packages/cli/dist/index.js harbor-exec "Create hello.sh printing hello" --agents claude-code,codex

# Re-run usage bench
bash jobs/mini-bench/host-micro/run-micro-bench-with-usage.sh
```

---

## Out of scope (Phase 5+)

- LLM planner (`planner.ts`) dynamic replan
- Sub-harness slash commands
- GitHub Actions CI
- `relay install`
- Full cost blend in blended-router (schema first in Phase 4)
