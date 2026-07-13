# Running Hecate & Testing Guidelines

This covers how to start the Hecate harness, how to run the test suite, and how
to use `hecate bench` to prove routing changes are actually improvements.

## Prerequisites

- **Node ≥ 22** and **pnpm 10** (`packageManager` pins `pnpm@10.33.0`).
- At least one agent CLI on your `PATH` for real runs: `claude`, `codex`,
  `cursor-agent`, or `pi`. Hecate detects what's installed; with none installed
  it still plans and routes but every step reports "no agent CLI found".

## Startup

```bash
pnpm install
pnpm build            # transpile all packages (tsc per workspace)

# Launch the interactive harness (pixelated HECATE banner, single prompt):
node packages/cli/dist/index.js
#   ^ first run asks which installed agents to enable, then drops you at `you ›`
```

Inside the harness:

- Type natural language — a **question** ("explain how routing works") is
  answered by the best conversational model; **work** ("build a todo API") is
  planned and delegated to agents.
- Commands: `status` · `agents` · `models` · `config` · `help`.
- **Quitting:** Hecate is intentionally hard to exit — a stray character never
  closes it. Press **Ctrl+C twice** to quit. Ctrl+D re-arms the reader.
- **Sessions are ephemeral:** each session's `.relay/sessions/<id>` folder is
  deleted on quit. Pass `--preserve` (or `-p`) to keep it:
  `node packages/cli/dist/index.js --preserve`.

Config lives in `relay/` (`registry.yaml`, `session-policy.yaml`,
`orchestrator.yaml`). Model strengths/weaknesses, planning/conversation ranks,
and Pi's `native-tool-loop`/`extensions` capability tags are all in
`registry.yaml` — edit these to change routing.

## Test suite

```bash
pnpm test           # vitest across every package
pnpm typecheck      # tsc --noEmit across every package
pnpm build          # also fails on type errors (tests are type-checked too)
```

Run one package: `pnpm --filter @relay/orchestrator test`.
Run one file: `pnpm --filter @relay/orchestrator exec vitest run src/intent.test.ts`.

Guidelines when changing routing/planning:

- **Pure logic stays unit-tested and deterministic.** Intent classification,
  capability routing, planner ranking, and plan-JSON parsing have no I/O — add
  cases to `intent.test.ts`, `capability-router.test.ts`, `planner-rank.test.ts`,
  `llm-planner.test.ts`.
- **Don't spawn real agents in tests.** Inject fakes. `runBenchmark` takes a
  `runners` seam; `processPrompt`/planning take an injected planner function.
- After a change: `pnpm build && pnpm test` must be green before benchmarking.

## Benchmarking — proving savings (`hecate bench`)

Every *work* prompt now makes an extra planner call before execution (the "spy
on planning" pass). The benchmark is how you confirm the routing pays for that
overhead versus a single agent doing the whole job.

Each task runs **twice** — once as a single-agent baseline, once through
Hecate's multi-agent orchestration — and the two are compared on wall-clock,
agent/model calls, estimated tokens (real usage scraped when the CLI prints it,
else a ~4-chars/token proxy), files changed, verify pass/fail, and cost.

### Try it with zero cost (simulate)

```bash
node packages/cli/dist/index.js bench --simulate
```

Runs a built-in 3-task example with deterministic stand-ins — no agents, no
tokens. Use it to sanity-check the pipeline and the report format. Numbers are
illustrative only.

### Real benchmark

1. Write a spec (see `fixtures/bench/example.yaml`):

   ```yaml
   baseline: claude-code          # harness for the single-agent baseline
   costPer1kTokens: { default: 0.015 }   # optional, enables $ estimates
   tasks:
     - id: todo-api
       goal: build a REST todo API with express and JWT auth
       verify: npm test           # optional; exit 0 = pass
   ```

2. Point it at a **disposable seed repo** so each run gets a clean, isolated
   copy (file-change counts stay meaningful and runs don't collide):

   ```bash
   node packages/cli/dist/index.js bench fixtures/bench/example.yaml \
     --workspace /path/to/seed-repo \
     --out bench-report.json
   ```

   Without `--workspace`, both modes run in the current directory — fine for a
   quick look, but they will modify the same tree.

### Reading the report

- Per-task rows show `baseline` then `hecate`, with a `Δ` line: `+%` wall and
  token numbers mean **Hecate improved**; the calls delta is shown raw (Hecate
  usually makes *more* calls — that's the tradeoff you're measuring).
- `--out` writes the full JSON (every metric per run, including changed files
  and captured output) for tracking across iterations.

### Iterating toward "actually better"

1. Fix a spec + seed repo and record a baseline report.
2. Change routing (edit `registry.yaml` ranks/capabilities, or the planner
   logic).
3. Re-run the same spec; diff `tokenPct` / `wallPct` / verify-pass counts.
4. Keep the change only if savings hold **without** dropping verify pass rate —
   cheaper output that fails the task is not a win.
