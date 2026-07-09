# Relay (hecate)

Personal dev agent mesh — one Product Session across Claude Code, Codex, Cursor, and Pi.

## Status (Dev A — Mesh Brain)

**Sprints 1–4 complete.** 4 packages, full session/handoff/routing/governance stack.

| Package | Purpose |
|---------|---------|
| `@relay/schema` | RHP v1, HandoffBundle, registry, session-policy, relay config |
| `@relay/registry` | Harness Cards + ThinRouter (deterministic, no LLM) |
| `@relay/session` | SessionStore, handoff builder, git snapshot, transcript trim, KPIs |
| `@relay/cli` | Full Mesh Brain CLI (see below) |

**Pending (Dev B — Harness Fabric):** `packages/adapters`, `packages/mcp`, `relay init/build/watch`, harness inject.

## CLI commands (Dev A)

```bash
relay registry list|show <harness>
relay session start <goal>
relay session status
relay handoff --to <harness|auto> [--lossless]
relay trace [session-id]
relay doctor --session [id]
relay doctor --kpi
```

## Quick start

```bash
pnpm install
pnpm build
pnpm test

cd fixtures/minimal-relay
node ../../packages/cli/dist/index.js registry list
node ../../packages/cli/dist/index.js session start "fix React component"
node ../../packages/cli/dist/index.js handoff --to auto
node ../../packages/cli/dist/index.js trace
node ../../packages/cli/dist/index.js doctor --session
node ../../packages/cli/dist/index.js doctor --kpi
```

> **Note:** `governance.requireGitSnapshotOnHandoff` requires a git commit. Initialize git and commit once, or set it to `false` in `relay/session-policy.yaml` for local testing.

## Architecture

Adapted from [ide-bridge](https://github.com/Xsidz/ide-bridge) (MIT) — see `packages/session/NOTICE.md`.

- **Thin router** — `relay handoff --to auto` picks harness via regex + Harness Cards (no LLM in OSS)
- **RHP** — versioned handoff protocol (`session.json`, `handoff.json`, `HANDOFF.md`)
- **Governance** — `events.jsonl` audit trail + `session-policy.yaml` rules

## Docs

| Doc | Topic |
|-----|-------|
| [docs/rhp-spec.md](./docs/rhp-spec.md) | Relay Handoff Protocol v1 |
| [docs/thin-router.md](./docs/thin-router.md) | OSS routing rules |
| [docs/agent-mesh-mapping.md](./docs/agent-mesh-mapping.md) | Kore/Red Hat/Solo/McRae mapping |
| [docs/security.md](./docs/security.md) | Local-only trust model |

## Monorepo

| Package | Owner | Status |
|---------|-------|--------|
| `@relay/schema` | Dev A | Done |
| `@relay/registry` | Dev A | Done |
| `@relay/session` | Dev A | Done |
| `@relay/cli` | Dev A (session/registry/handoff/trace/doctor) | Done |
| `@relay/adapters` | Dev B | Sprint 2 (4 adapters, session inject, watch) |
| `@relay/mcp` | Dev B | Not started (Sprint 3) |

## Pro features (stubs)

```bash
relay handoff --to auto --smart   # Coming v0.2 Pro
relay trace --otel                # Coming v0.2 Pro
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Dev A / Dev B split.
