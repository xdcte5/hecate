# Quickstart — first handoff in under 15 minutes

Relay gives one **Product Session** to Claude Code, Codex, Cursor, and Pi so you can
switch agents mid-feature without re-explaining. This walks the full loop: configure once,
work in one agent, hand off to another with zero re-typing.

## 0. Install

```bash
pnpm install && pnpm build
# use the built CLI directly, or link it:
alias relay="node $PWD/packages/cli/dist/index.js"
```

## 1. Initialize `relay/`

From your project root:

```bash
relay init          # scaffolds relay/, enabling only harnesses found on PATH
```

Already have an `AGENTS.md`, `CLAUDE.md`, or `.codex/`? Import it instead of starting blank:

```bash
relay migrate --from agents-md    # or: --from claude | --from codex
```

Edit `relay/instructions.md` — this is your single source of truth. Add subagents under
`relay/agents/`, skills under `relay/skills/`, and MCP servers in `relay/mcp.json`.

## 2. Build native harness configs

```bash
relay build --all
```

This transpiles `relay/` into `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/main.mdc`, Pi's
overlay, and each harness's MCP config — and writes `relay.lock`. Leave it running to
rebuild on every change:

```bash
relay watch
```

## 3. Start a session and work

```bash
relay session start "add oauth login"
relay build --all      # injects a HANDOFF pointer into every harness
```

Open Claude Code (or any harness) and work normally. Record decisions as you go — from the
CLI or, if the harness speaks MCP, via the `relay-mcp` tools (`relay mcp install` once):

```bash
relay session status
```

## 4. Hand off to another agent

```bash
relay handoff --to auto      # ThinRouter picks a harness from your rules + cards
# or target one explicitly:
relay handoff --to cursor
relay build --all            # re-inject the updated session
```

Open the target harness — its instruction file already points at the session's
`HANDOFF.md`, so it picks up the goal, decisions, and git state with no re-explaining.

## 5. Verify

```bash
relay doctor            # generated files match relay.lock (no drift)
relay trace             # every handoff hop, from events.jsonl
```

## The 60-second loop, distilled

```
relay session start "goal"
   ↓ work in Claude
relay handoff --to auto  →  relay build --all  →  open the suggested agent
   ↓ keep working, no re-explaining
relay trace              # see the whole hop history
```

That's the magical moment: Claude → Cursor (or Codex, or Pi) carrying one Product Session.

## 6. Fusion chat demo (Pi × Relay)

For the full automatic mesh loop — one prompt, plan, execute, verify — use chat mode:

```bash
cd fixtures/minimal-relay   # sample project with relay/ preconfigured
relay
# you › add a demo feature
# → Relay plans steps, runs Pi (or failover), streams tool events
# → No manual handoff / next / done
```

Author skills under `relay/skills/` and sub-agents under `relay/agents/`. Pi RPC sessions
receive skill paths via `RELAY_SKILLS_*` env vars. See [skills-bridge.md](./skills-bridge.md).

`relay dash` is deprecated — plan panels and handoff hops are merging into chat mode.

### CI / mock driver

Set `RELAY_MOCK_DRIVER=1` to run the orchestrator with a deterministic mock harness (no
real agent CLIs). The fusion E2E test in `fixtures/minimal-relay/e2e/fusion.test.ts`
exercises prompt → plan → step events this way.
