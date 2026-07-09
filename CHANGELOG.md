# Changelog

All notable changes to Relay are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are grouped by dev track (**Mesh Brain** = Dev A, **Harness Fabric** = Dev B)
so the two parallel workstreams stay legible after merge. Per-sprint detail for the
Harness Fabric track lives in [docs/dev-b-track.md](./docs/dev-b-track.md).

## [Unreleased]

### Added — Harness Fabric (Dev B)

_Nothing yet — Sprint 1 in progress._

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
