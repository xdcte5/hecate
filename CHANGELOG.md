# Changelog

All notable changes to Relay are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by dev track (**Mesh Brain** = Dev A, **Harness Fabric** = Dev B)
so the two parallel workstreams stay legible after merge. Per-sprint detail for the
Harness Fabric track lives in [docs/dev-b-track.md](./docs/dev-b-track.md).

## [Unreleased]

### Added — Super-Harness Orchestrator

Turns Relay from a router + context broker into a **single harness you launch once** that
plans a goal, routes each step to the best agent, and runs agents automatically — a first
cut of the "log in once, fan out to your subscriptions" vision. (Reference plan:
[docs/pi-harness-plan.md](./docs/pi-harness-plan.md).)

- `@relay/orchestrator` (new package):
  - **Goal analysis** (`goal-analysis.ts`) — classify a natural-language goal into
    build/fix/test/review/refactor + frontend/backend layers.
  - **Planner** (`plan.ts`) — decompose a goal into routed steps grouped into execution
    **waves**; independent implement steps (frontend + backend) share wave 0.
  - **Wave executor** (`execute-plan.ts`) — runs all agents in a wave **in parallel**
    (`Promise.all`), with verification gates between waves, per-step model routing,
    fallback resolution, post-run session updates, and an automatic `relay build` sync.
  - **Harness drivers** (`drivers/`) — `HarnessDriver` interface with a `CliDriver`
    (spawn `claude`/`codex`/`cursor-agent` with the handoff prompt) and a real
    **`PiRpcDriver`** (JSONL RPC to `pi --mode rpc`, streaming tool events).
  - Supporting modules: `launcher`, `launch-args`, `auto-run`, `resolve-binary`,
    `resolve-fallback`, `verify`, `outcome`, `post-run`, `process-prompt`, `runner`.
- `@relay/registry`: **ability-based + model routing** — `TaskRouter` (task→harness via
  `task-signals.ts`), `ModelRouter` (task→model from per-harness `ModelCard`s), extending
  the deterministic `ThinRouter`.
- `@relay/schema`: `ModelCardSchema` on Harness Cards (per-model strengths/weaknesses).
- `@relay/cli`:
  - **Chat is the default** — bare `relay` (TTY) opens a Pi-style REPL that plans and runs
    agents from plain English.
  - New commands: `relay chat`, `relay run <goal> [--launch|--clipboard|--next|--status]`,
    `relay dash` (power-user dashboard), `relay harbor-exec`.
  - Pi-inspired TUI: `relay-tui`, agent/model pickers, footer bar, transcript, hops view,
    `local-config` (`.relay/local-config.json`: enabled agents, model overrides, auto/manual).
- Harbor: `scripts/harbor/relay_agent.py` + `relay harbor-exec` for terminal-bench runs.
- Registry sample (`fixtures/minimal-relay/relay/registry.yaml`) gains per-model cards and
  ability signals; `session-policy.yaml` failover reordered to `pi → cursor → claude → codex`.

### Added — Harness Fabric (Dev B)

**Sprint 1 — Adapter foundation + Claude/Codex**

- `@relay/schema`: `AdapterManifest`, `ManifestEntry`, `RelayLock` types + `emptyRelayLock`.
- `@relay/adapters`: new package — `Adapter` interface, `BaseAdapter`, `RelaySource`
  reader, `ClaudeAdapter`, `CodexAdapter`, `mcp-transform` (Claude JSON + Codex TOML),
  manifest writer with sha-256 checksums, `relay.lock` reader/writer, `detectDrift`,
  and binary detection for `relay init`.
- `@relay/cli`: `relay init` (scaffolds `relay/`, enables only detected harnesses),
  `relay build [--harness <id>|--all]`, and `relay doctor --build` (default) drift check.
- Golden tests: `fixtures/golden/claude/`, `fixtures/golden/codex/`
  (regenerate with `UPDATE_GOLDEN=1`).
- `packages/adapters/README.md` documents the adapter model and matrix.

**Sprint 2 — Cursor/Pi + session inject + watch**

- `@relay/adapters`: `CursorAdapter` (`.cursor/rules/main.mdc` + mcp/skills/agents),
  `PiAdapter` (project `AGENTS.md` + agents/skills/prompts/mcp), `toCursorJson`.
- Session inject: `BaseAdapter.agentsSessionFooter` + per-adapter inject weave the active
  session's HANDOFF pointer into every harness's instruction file. Codex and Pi emit a
  byte-identical `AGENTS.md`; `buildProject` fails loudly on any cross-adapter path conflict.
- `@relay/cli`: `relay build` now injects the active session and accepts `--pi-global`
  (writes Pi to `~/.pi`, untracked in `relay.lock`); new `relay watch` rebuilds on
  `relay/` changes (debounced).
- Golden fixtures extended to all 4 harnesses; new `build.test.ts` covers inject,
  conflict detection, and pi-global.

**Sprint 3 — MCP mesh fabric**

- `@relay/mcp`: new package — `relay-mcp` stdio server + five tools (`session_get`,
  `session_record_decision`, `session_record_progress`, `handoff_prepare`,
  `registry_list`) that call into `@relay/session` and `@relay/registry`. SDK-free tool
  handlers are unit-tested; `bin.ts` serves over `StdioServerTransport`.
- `@relay/adapters`: `mcp-transform` round-trip — added `fromClaudeJson`, `fromCursorJson`,
  and a narrow `fromCodexToml` parser with cross-format round-trip tests.
- `@relay/cli`: `relay mcp install` (writes MCP config incl. a `relay` server into all
  harnesses), `relay mcp list` (merged virtual surface), and `relay migrate --from
  agents-md` (imports AGENTS.md + agents/skills/prompts/mcp into `relay/`). Shared
  scaffold defaults factored into `scaffold.ts`.
- Verified end-to-end: a decision recorded via the stdio MCP server lands in
  `events.jsonl` and the next handoff.

**Sprint 4 — Integration + docs**

- `@relay/cli`: `relay migrate --from` now also handles `claude` and `codex` harness
  layouts (CLAUDE.md / AGENTS.md + agents/skills/commands + MCP config, TOML parsed back
  to JSON).
- Docs: `docs/adapter-matrix.md` (source→output + MCP formats + drift model) and
  `docs/quickstart.md` (< 15 min first handoff).
- Cross-track E2E test (`packages/cli/src/e2e.test.ts`): session start → build → inject
  in all 4 harnesses → doctor clean → handoff → rebuild, driving the real CLI.

### Added — Mesh Brain (Dev A)

- `@relay/schema`: RHP v1, HandoffBundle, registry, session-policy, relay config Zod types.
- `@relay/registry`: Harness Cards loader + deterministic ThinRouter (regex, no LLM).
- `@relay/session`: SessionStore CRUD, `events.jsonl` audit log, RHP builder, git snapshot,
  transcript trimmer, Brownfield KPI evaluator.
- `@relay/cli`: `registry list|show`, `session start|status`, `handoff --to <harness|auto>`,
  `trace`, `doctor --session|--kpi`, Pro-gate stubs (`--smart`, `--otel`).
- Docs: `rhp-spec.md`, `thin-router.md`, `agent-mesh-mapping.md`, `security.md`.

### Fixed

- `fixtures/minimal-relay/` — Week 0 shared fixture created so registry/session/cli
  suites resolve their canonical `relay/` source (was referenced but never committed).

[Unreleased]: https://github.com/xdcte5/hecate/compare/main...madhav
