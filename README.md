# Relay (hecate)

Personal dev agent mesh — one Product Session across Claude Code, Codex, Cursor, and Pi.

## Status

**Both tracks complete.** 6 packages, full session/handoff/routing/governance stack
(Mesh Brain) plus 4 harness adapters, manifest-owned build, and MCP mesh fabric
(Harness Fabric).

| Package | Track | Purpose |
|---------|-------|---------|
| `@relay/schema` | Mesh Brain | RHP v1, HandoffBundle, registry, session-policy, relay config, adapter manifest |
| `@relay/registry` | Mesh Brain | Harness Cards + ThinRouter (deterministic, no LLM) |
| `@relay/session` | Mesh Brain | SessionStore, handoff builder, git snapshot, transcript trim, KPIs |
| `@relay/adapters` | Harness Fabric | Claude/Codex/Cursor/Pi adapters, `relay.lock` drift, mcp-transform |
| `@relay/mcp` | Harness Fabric | `relay-mcp` stdio server + 5 session/registry tools |
| `@relay/cli` | Both | `init`, `build`, `watch`, `doctor`, `migrate`, `mcp`, `session`, `handoff`, `trace`, `registry` |

## CLI commands

Mesh Brain (Dev A):

```bash
relay registry list|show <harness>
relay session start <goal>
relay session status
relay handoff --to <harness|auto> [--lossless]
relay trace [session-id]
relay doctor --session [id] | --kpi
```

Harness Fabric (Dev B):

```bash
relay init                         # scaffold relay/, enable detected harnesses
relay build [--harness <id>|--all] [--pi-global]
relay watch                        # rebuild on relay/ changes
relay doctor [--build]             # generated-file drift vs relay.lock (default)
relay migrate --from agents-md|claude|codex
relay mcp install|list             # MCP mesh fabric
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
| [docs/quickstart.md](./docs/quickstart.md) | First handoff in < 15 min |
| [docs/adapter-matrix.md](./docs/adapter-matrix.md) | Source → harness output mapping |

## Monorepo

| Package | Owner | Status |
|---------|-------|--------|
| `@relay/schema` | Dev A | Done |
| `@relay/registry` | Dev A | Done |
| `@relay/session` | Dev A | Done |
| `@relay/cli` | Both | Done |
| `@relay/adapters` | Dev B | Done (4 adapters, manifest/drift, mcp-transform) |
| `@relay/mcp` | Dev B | Done (relay-mcp stdio, 5 tools) |

## Pro features (stubs)

```bash
relay handoff --to auto --smart   # Coming v0.2 Pro
relay trace --otel                # Coming v0.2 Pro
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Dev A / Dev B split.
