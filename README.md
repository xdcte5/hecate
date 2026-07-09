# Relay (hecate)

Personal dev agent mesh — one Product Session across Claude Code, Codex, Cursor, and Pi.

## Status

**7 packages.** Full session/handoff/routing/governance stack (Mesh Brain), 4 harness
adapters + manifest-owned build + MCP mesh fabric (Harness Fabric), and an
auto-orchestrator that plans a goal and fans agents out in parallel (Super-Harness).

| Package | Track | Purpose |
|---------|-------|---------|
| `@relay/schema` | Mesh Brain | RHP v1, HandoffBundle, registry + model cards, session-policy, adapter manifest |
| `@relay/registry` | Mesh Brain | Harness Cards + ThinRouter / TaskRouter / ModelRouter (deterministic) |
| `@relay/session` | Mesh Brain | SessionStore, handoff builder, git snapshot, transcript trim, KPIs |
| `@relay/adapters` | Harness Fabric | Claude/Codex/Cursor/Pi adapters, `relay.lock` drift, mcp-transform |
| `@relay/mcp` | Harness Fabric | `relay-mcp` stdio server + 5 session/registry tools |
| `@relay/orchestrator` | Super-Harness | Goal analysis, wave planner, parallel executor, harness drivers (CLI + Pi RPC) |
| `@relay/cli` | All | `init`/`build`/`watch`/`doctor`/`migrate`/`mcp` + `chat`/`run`/`dash` + `session`/`handoff`/`trace`/`registry` |

## CLI commands

Mesh Brain (Dev A):

```bash
relay registry list|show <harness>
relay session start <goal>
relay session status
relay handoff --to <harness|auto> [--lossless]
relay run <goal> [--launch] [--clipboard] [--next] [--status]
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

## Default: chat mode

```bash
relay
```

Type natural language — Relay plans steps and runs agents automatically (Claude, Codex, Cursor, Pi).

```bash
relay chat                     # same as bare `relay`
relay dash                     # power-user dashboard (optional)
relay run <goal> [--launch]    # low-level orchestration (optional)
```

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
| [docs/pi-harness-plan.md](./docs/pi-harness-plan.md) | Super-harness runtime roadmap (Pi-inspired) |

## Pro features (stubs)

```bash
relay handoff --to auto --smart   # Coming v0.2 Pro
relay trace --otel                # Coming v0.2 Pro
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Dev A / Dev B split.
