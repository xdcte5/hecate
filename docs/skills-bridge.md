# Skills bridge — `relay/skills/` → Pi RPC

Relay skills live as markdown under `relay/skills/`. The orchestrator loads them at
run time and passes discovery metadata into Pi RPC sessions.

## Authoring a skill

Create `relay/skills/<name>.md` with YAML frontmatter:

```markdown
---
name: review
description: Review diffs for correctness and simplification.
---

You are a focused reviewer. Read the diff, flag bugs first, then simplification wins.
```

Run `relay build --all` to transpile skills into harness overlays. At execute time,
`skills-bridge.ts` reads the source files directly (no rebuild required for the bridge).

## Runtime wiring

When a Pi RPC step runs, the driver sets:

| Env var | Purpose |
|---------|---------|
| `RELAY_SKILLS_PATH` | Colon-separated absolute paths to skill `.md` files |
| `RELAY_SKILLS_NAMES` | Comma-separated skill names |
| `RELAY_SKILLS_DIR` | Absolute path to `relay/skills/` |
| `RELAY_MCP_CONFIG` | Path to `relay/mcp.json` when present |

The agent prompt also includes a **Relay skills** catalog and an optional **Active skill**
section when the user invokes `/skill:<name>`.

## Sub-harness agents

`relay/agents/*.md` defines slash sub-harnesses (`/agent:reviewer`). Sprint 7 ships a stub
in `sub-harness.ts` that resolves agent definitions and formats child prompts; full child
process spawning is deferred.

## MCP

Install relay-mcp into harness configs:

```bash
relay mcp install
relay mcp list
```

Pi RPC inherits `relay/mcp.json` via `RELAY_MCP_CONFIG`.
