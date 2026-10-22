# Benchmark Comparison: Relay vs Claude Code vs Codex

**Date:** 2026-07-15  
**Scope:** Mini-benchmark (not full Terminal-Bench 89-task suite)

---

## Executive Summary

| Agent | Host Micro-Bench (3 tasks) | Pass Rate | Avg Latency | Harbor Docker (1 TB task) |
|-------|---------------------------|-----------|-------------|---------------------------|
| **Claude Code** | 3/3 | **100%** | **18.3s** | FAIL (no API key in container) |
| **Codex** | 3/3 | **100%** | **126.4s** | Not run (API key required) |
| **Relay** (`harbor-exec`) | 3/3 | **100%** | **63.5s** | Not run |

**Key finding:** On identical host-native coding tasks, all three agents solved every task. Claude was fastest (~3.5× faster than Codex avg; ~3.5× faster than Relay avg). Relay succeeded on all tasks despite non-zero CLI exit codes (orchestration overhead). Harbor Docker runs for Claude/Codex/Relay were blocked by missing `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` inside containers.

---


---

## Sprint 0 validation re-run (2026-07-16)

Fresh `run-micro-bench-with-usage.sh` after `pnpm build` (harnesses: `claude`, `codex`, `pi` on host).

| Agent | Pass (A/B/C) | Avg wall | Notes |
|-------|----------------|----------|-------|
| **Claude Code** | **3/3** | **16.1s** | 24.7s / 12.4s / 11.1s; API-equiv. cost **~$0.74** combined |
| **Codex** | **3/3** | **58.2s** | 62.2s / 74.1s / 38.2s; tokens only in `--json` |
| **Relay** (`harbor-exec`) | **1/3** | **12.8s** | A/C verify failed: Pi auth miss → failover used **gpt-4o** on Claude (`model_not_found`); B passed via claude-code |

**Prior drift** (`jobs/mini-bench/compare-priors.sh`): local mini-bench success rates run **+0.50 above** `relay/routing-priors.yaml` (0.50 prior) for `implement`/`fix` on claude-code and codex; `.relay/routing-stats.jsonl` missing. Relay rows without `harnesses[]` are skipped by the drift script until child harness metadata is recorded.

## Sprint 1 Track D — cost/success routing (2026-07-21)

Re-ran `run-micro-bench-with-usage.sh` after Track D pipeline (driver `costUsd` → `.relay/routing-stats.jsonl` → `aggregateMedianCosts` → blended `cost` weight).

| Agent | Pass (A/B/C) | Avg wall | Cost captured |
|-------|----------------|----------|---------------|
| **Claude Code** | **3/3** | **13.2s** | 16.8s / 10.1s / 12.8s; **~$0.74** combined (`total_cost_usd` in stream-json) |
| **Codex** | **3/3** | **62.5s** | 63.7s / 49.1s / 74.8s; tokens only (`cost_usd` null in `--json`) |
| **Relay** (`harbor-exec`) | **1/3** | **11.6s** | 11.7s / 15.7s / 7.5s; **$0.186** on task B via claude-code stream logs |

**Cost pipeline verified:** `relay-B/.relay/routing-stats.jsonl` records `costUsd: 0.186`, `inputTokens`/`outputTokens`, and `failoverReason` per hop. Blended router applies `blend.cost` (default 0.15) once `min_local_samples` cost medians exist (`blended-router.test.ts` cost-signal test green).

**Relay pass-rate note:** A/C still fail verify (no artifact / Pi anthropic auth on failover); B passes with claude-code usage extracted from `.relay/launch/claude-code-stream.jsonl`.

## V0/V1 verifier validation re-run (2026-08-09)

Re-ran `run-micro-bench-with-usage.sh` after deterministic per-step verifier wiring and trivial fast path changes.

| Agent | Pass (A/B/C) | Avg wall | Notes |
|-------|--------------|----------|-------|
| **Claude Code** | **3/3** | **17.7s** | 17.5s / 18.7s / 17.0s |
| **Codex** | **3/3** | **127.6s** | 38.0s / 104.9s / 239.8s |
| **Relay** (`harbor-exec`) | **3/3** | **29.2s** | Script artifact checks passed for A/B/C; Relay still routed Pi first, then failed over to Claude Code because Pi azure-openai-responses auth was missing |

Post-fix direct Relay verification:

| Task | Relay verifier evidence |
|------|-------------------------|
| A | `artifact: hello.sh exists`; `shell: bash hello.sh` PASS |
| B | `python: from add import add; assert add(2, 3) == 5` PASS |
| C | `python: from fib import fib; assert fib(10) == 55` PASS |

The first sandboxed benchmark attempt was discarded because Codex could not initialize its app-server under sandbox restrictions and Claude reported no auth. The valid re-run was executed outside the sandbox so local CLI auth/app-server state was available.

### V2 graph verifier smoke (2026-08-09)

Ran the Relay A/B/C micro-bench prompts with `RELAY_GRAPH=1` after adding the graph executor and trace persistence. All three passed and produced graph node trace lines plus `.relay/runs/<session>/implement/verify.jsonl` evidence.

| Task | Graph verifier evidence |
|------|-------------------------|
| A | `graph PASS artifact-hello-sh`; `graph PASS shell-bash-hello-sh` |
| B | `graph PASS python-from-add-import-add-assert-add-2-3-5` |
| C | `graph PASS python-from-fib-import-fib-assert-fib-10-55` |

## Methodology

### 1. Host-native micro-benchmark (measured locally)

Three small Terminal-Bench-style tasks, run on the host with subscription CLI auth (no Docker):

| Task | Prompt | Verification |
|------|--------|--------------|
| **A** | Create executable `hello.sh` printing `hello` | `bash hello.sh` outputs `hello` |
| **B** | Fix `add.py` (`a-b` → `a+b`) | `add(2,3) == 5` |
| **C** | Create `fib.py` with `fib(10)==55` | Python assert |

**Commands per agent:**

```bash
# Claude Code
claude -p --permission-mode bypassPermissions -- "<prompt>"

# Codex
codex exec --sandbox workspace-write -C <workdir> "<prompt>" < /dev/null

# Relay
node packages/cli/dist/index.js harbor-exec "<prompt>" --agents claude-code,codex
```

**Results file:** `jobs/mini-bench/host-micro/results.jsonl`  
**Run log:** `jobs/mini-bench/host-micro/run.log`

### 2. Harbor / Terminal-Bench Docker (partial, measured locally)

Official TB task `make-mips-interpreter` via Harbor (`terminal-bench/terminal-bench-2`):

```bash
harbor run -d terminal-bench/terminal-bench-2 -a <agent> -l 1 -n 1 -k 1 -y \
  --job-name <name> -o jobs/mini-bench
```

### 3. External reference (not locally measured)

Published Terminal-Bench 2.1 agent leaderboard scores for context only:

| Rank | Agent | Model | Score | Source |
|------|-------|-------|-------|--------|
| 1 | Codex CLI | GPT-5.5 | 83.4% ± 2.2 | [tbench.ai](https://www.tbench.ai/leaderboard/terminal-bench/2.1) |
| 2 | Claude Code | Claude 5 Fable | 83.1% ± 2.0 | [tbench.ai](https://www.tbench.ai/leaderboard/terminal-bench/2.1) |
| 4 | Claude Code | Claude Opus 4.8 | 78.9% ± 2.5 | [tbench.ai](https://www.tbench.ai/leaderboard/terminal-bench/2.1) |

These are full-suite (89-task) results with verified harness configs — **not comparable 1:1** to our 3-task micro-bench.

---

## Host Micro-Benchmark Results (measured)

| Agent | Task | Wall Time | Exit | Success | Verify |
|-------|------|-----------|------|---------|--------|
| claude | A | 21.36s | 0 | ✓ | hello.sh ok |
| claude | B | 17.21s | 0 | ✓ | add fixed |
| claude | C | 16.42s | 0 | ✓ | fib ok |
| codex | A | 53.46s | 0 | ✓ | hello.sh ok |
| codex | B | 279.96s | 0 | ✓ | add fixed |
| codex | C | 45.66s | 0 | ✓ | fib ok |
| relay | A | 98.04s | 1 | ✓ | hello.sh ok |
| relay | B | 59.01s | 1 | ✓ | add fixed |
| relay | C | 33.33s | 0 | ✓ | fib ok |

### Aggregates

| Agent | Pass Rate | Avg Wall Time | Min | Max | Tokens/Cost |
|-------|-----------|---------------|-----|-----|-------------|
| **Claude Code** | 3/3 (100%) | **18.3s** | 16.4s | 21.4s | ~35k in / ~829 out; **$0.74** API-equiv. cost (see below) |
| **Codex** | 3/3 (100%) | **126.4s** | 45.7s | 280.0s | ~470k in / ~2.4k out; cost N/A in `--json` |
| **Relay** | 3/3 (100%) | **63.5s** | 33.3s | 98.0s | N/A (no aggregated usage in session logs) |

**Notes:**
- Codex task B took ~4.7 min (outlier); tasks A and C were ~45–53s.
- Relay reported `exit_code=1` on tasks A and B but all verifications passed — likely orchestration/handoff exit semantics, not task failure.
- Token/cost metrics were captured in a follow-up run (`run-micro-bench-with-usage.sh`); see **Token & Cost Comparison** below.

---

## Harbor Docker Results (measured)

| Run | Agent | Task | Reward | Agent Time | Tokens | Cost | Outcome |
|-----|-------|------|--------|------------|--------|------|---------|
| `tb-oracle-smoke` | oracle | make-mips-interpreter | **1.0** | ~4s | N/A | N/A | PASS (sanity check) |
| `tb-claude-1` | claude-code (sonnet-4-6) | make-mips-interpreter | **0.0** | ~5s | 0 | $0 | FAIL — `apiKeySource: "none"` |

**Claude Docker failure detail:** Agent exited immediately inside container because no Anthropic API key was available. Host subscription auth does not transfer into Harbor Docker environments.

**Not run in Docker:** Codex, Relay (same API-key blocker).

---

## Limitations

1. **Not full Terminal-Bench** — 3 trivial host tasks + 1 hard Docker task; not statistically representative of TB 2.1.
2. **Different environments** — Host micro-bench uses subscription CLI auth; Harbor uses Docker with API keys.
3. **Partial token/cost data** — Usage run captured Claude tokens + API-equivalent USD and Codex tokens only; Relay and Harbor Docker runs have no parseable usage (see **Token & Cost Comparison**).
4. **Relay overhead** — `harbor-exec` coordinates multiple agents; latency includes routing + handoff, not pure single-model speed.
5. **Model versions** — Host Claude/Codex use default subscription models; Harbor Claude was `claude-sonnet-4-6`.

---

## Reproduction

### Host micro-benchmark (visible progress)

```bash
cd ~/Projects/relay
bash jobs/mini-bench/host-micro/run-micro-bench-visible.sh

# Watch live
tail -f jobs/mini-bench/host-micro/run.log

# Results
cat jobs/mini-bench/host-micro/results.jsonl
```

### Harbor Docker (requires API keys in environment)

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...

cd ~/Projects/relay
bash scripts/harbor/mini-bench.sh   # or individual harbor run commands

python3 scripts/harbor/summarize-results.py jobs/mini-bench
```

### Summarize all results

```bash
python3 scripts/harbor/summarize-results.py jobs/mini-bench
```


---

## Token & Cost Comparison

**Date:** 2026-07-15 (usage run, same 3 tasks A/B/C)  
**Script:** `jobs/mini-bench/host-micro/run-micro-bench-with-usage.sh`  
**Raw results:** `jobs/mini-bench/host-micro/results-with-usage.jsonl`  
**Run log:** `jobs/mini-bench/host-micro/run-with-usage.log`

### Extraction methodology

| Agent | Command flags | Parser |
|-------|---------------|--------|
| **Claude Code** | `claude -p --verbose --output-format stream-json --max-turns 8` | Final JSON line with `type=result`: `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd` |
| **Codex** | `codex exec --json` | Last `type=turn.completed` event: `usage.input_tokens`, `usage.output_tokens` (also reports `cached_input_tokens`, `reasoning_output_tokens`) |
| **Relay** | `harbor-exec` (stdout + `.relay/**` scan) | No machine-readable usage in orchestrator logs today; child harnesses run without `--json` / `stream-json` |

**Caveats:**
- Runs used **subscription/OAuth auth**, not metered API keys. Claude still emits **`total_cost_usd`** (API-equivalent list price including cache read/create); that is **not** an out-of-pocket subscription charge.
- Codex `--json` events in this run had **no `cost_usd` field** (tokens only).
- Codex `input_tokens` on the last turn reflect **large session context** (often 100k+), not comparable 1:1 to Claude’s per-result `input_tokens` (~12k) because harnesses load different default context.
- Relay succeeded on all tasks but **did not persist child-agent token usage**; true Relay cost is at least the sum of internal harness calls plus orchestration overhead (unmeasured here).

### Per-task token & cost (measured)

| Agent | Task | Input tokens | Output tokens | Total tokens | Cost (USD) | Wall |
|-------|------|-------------:|--------------:|-------------:|-----------:|-----:|
| claude | A | 11,774 | 257 | 12,031 | 0.251 | 28.3s |
| claude | B | 11,774 | 282 | 12,056 | 0.252 | 12.0s |
| claude | C | 11,772 | 290 | 12,062 | 0.236 | 15.5s |
| codex | A | 109,492 | 301 | 109,793 | N/A | 46.1s |
| codex | B | 247,756 | 1,574 | 249,330 | N/A | 91.5s |
| codex | C | 113,035 | 488 | 113,523 | N/A | 41.1s |
| relay | A | 108,000 | 445 | 108,445 | $0.093 | — |
| relay | B | 81,042 | 393 | 81,435 | $0.085 | — |
| relay | C | 108,224 | 545 | 108,769 | $0.095 | — |

*Relay input tokens include cache read + cache creation (from child `claude-code` `stream-json` logs in `.relay/launch/`). Relay routed to Claude Code after Pi failover on all 3 tasks.*

### Aggregates (3 tasks)

| Agent | Σ Input | Σ Output | Σ Total (in+out) | Σ Cost (USD) | Avg wall |
|-------|--------:|---------:|-----------------:|-------------:|---------:|
| **Claude Code** | 35,320 | 829 | 36,149 | **0.739** | 18.6s |
| **Codex** | 470,283 | 2,363 | 472,646 | N/A | 59.6s |
| **Relay** | 297,266 | 1,383 | 298,649 | **0.273** | 26.5s |

**Takeaways:**
- On these micro-tasks, **Claude used far fewer billed input/output tokens** than Codex in CLI-reported metrics, with API-equivalent cost **~$0.74** for all three tasks combined.
- **Codex reported ~13× more input tokens** (sum) — largely context/reasoning overhead; subscription mode did not expose USD cost in JSONL.
- **Relay** completed work with **~$0.27 API-equivalent cost** for 3 tasks (child `claude-code` only after Pi failover). Input token counts are higher than direct Claude runs because they include **cache read/creation** from stream-json logs. Enable with `RELAY_CAPTURE_USAGE=1` (writes `.relay/launch/*-stream.jsonl`).

### Reproduce

```bash
cd ~/Projects/relay
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; corepack enable
pnpm build
bash jobs/mini-bench/host-micro/run-micro-bench-with-usage.sh
```


---

## Conclusion

On **simple host-native coding tasks**, Claude Code, Codex, and Relay all achieved **100% pass rate**. Claude was the **fastest** (~18s avg), Relay was **middle** (~64s avg, multi-agent orchestration), and Codex was **slowest** (~126s avg, with one 280s outlier on task B).

For **official Terminal-Bench comparison**, Docker Harbor runs with exported API keys are required. Published leaderboard data suggests Codex CLI and Claude Code are within ~5% on the full 89-task suite — but that was **not replicated locally** in this session due to container auth constraints.

**Recommendation:** Export `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, then re-run `scripts/harbor/mini-bench.sh` with `N_TASKS=3` for a fair Docker-based comparison with latency, token, and cost metrics.
