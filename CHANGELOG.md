# Changelog

All notable changes to Relay are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by dev track (**Mesh Brain** = Dev A, **Harness Fabric** = Dev B)
so the two parallel workstreams stay legible after merge. Per-sprint detail for the
Harness Fabric track lives in [docs/dev-b-track.md](./docs/dev-b-track.md).

## [Unreleased]

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
