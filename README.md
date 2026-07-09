# Hecate

Personal **super-harness** — log in once across your agent subscriptions
(Claude Code, Codex, Cursor, Pi, Gemini CLI), then hand one Product Session to whichever
agent fits, or let Hecate fan a goal out across several in parallel. Local, inspectable.

The CLI is `hecate` (with `relay` as an alias). Bare `hecate` opens a chat REPL that plans
a goal and runs agents automatically.

## Status

**7 packages, 5 harnesses.** Session/handoff/routing/governance (Mesh Brain), 5 harness
adapters + manifest-owned build + MCP mesh fabric (Harness Fabric), and an auto-orchestrator
that plans a goal and fans agents out in parallel into isolated sub-sessions (Super-Harness).

| Package | Track | Purpose |
|---------|-------|---------|
| `@relay/schema` | Mesh Brain | RHP v1 (+ parent/child), HandoffBundle, registry + model cards, adapter manifest |
| `@relay/registry` | Mesh Brain | Harness Cards + ThinRouter / TaskRouter / ModelRouter (deterministic) |
| `@relay/session` | Mesh Brain | SessionStore (+ child sub-sessions), handoff builder, git snapshot, KPIs |
| `@relay/adapters` | Harness Fabric | Claude/Codex/Cursor/Pi/Gemini adapters, `relay.lock` drift, mcp-transform |
| `@relay/mcp` | Harness Fabric | `relay-mcp` stdio server + 5 session/registry tools |
| `@relay/orchestrator` | Super-Harness | Goal analysis, wave planner, parallel fan-out executor, drivers (CLI + Pi RPC) |
| `@relay/cli` | All | `login`/`config`/`init`/`build`/`chat`/`run`/`dash` + `session`/`handoff`/`trace`/`mcp`/… |

## CLI commands

Super-harness:

```bash
hecate                             # chat REPL — plans a goal, runs agents (relay alias works too)
hecate login [harness] | --status  # run each subscription's own native login
hecate config [init]               # relay/orchestrator.yaml: concurrency, routing, models, verify
hecate run <goal> [--launch]       # low-level orchestration
hecate dash                        # power-user dashboard
```

Session + mesh:

```bash
relay session start <goal> | list | status | resume <id>
relay handoff --to <harness|auto> [--lossless]
relay trace [session-id] [--children]
relay registry list|show <harness>
relay doctor --session [id] | --kpi
```

Harness fabric:

```bash
relay init                         # scaffold relay/, enable detected harnesses
relay build [--harness <id>|--all] [--pi-global]
relay watch                        # rebuild on relay/ changes
relay doctor [--build]             # generated-file drift vs relay.lock (default)
relay migrate --from agents-md|claude|codex
relay mcp install|list             # MCP mesh fabric
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
