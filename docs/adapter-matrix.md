# Adapter matrix

How Relay transpiles the canonical `relay/` source into each harness's native layout.
Humans edit `relay/`; `relay build` writes the outputs; `relay doctor` flags any hand
edits to generated files (drift) against `relay.lock`.

## Source → output

| `relay/` source     | Claude Code           | Codex                | Cursor                  | Pi           |
| ------------------- | --------------------- | -------------------- | ----------------------- | ------------ |
| `instructions.md`   | `CLAUDE.md`           | `AGENTS.md`          | `.cursor/rules/main.mdc`| `AGENTS.md`  |
| `agents/*.md`       | `.claude/agents/`     | `.codex/skills/`     | `.cursor/agents/`       | `agents/`    |
| `skills/*.md`       | `.claude/skills/`     | `.codex/skills/`     | `.cursor/skills/`       | `skills/`    |
| `commands/*.md`     | `.claude/commands/`   | —                    | —                       | `prompts/`   |
| `mcp.json`          | `.mcp.json`           | `.codex/config.toml` | `.cursor/mcp.json`      | `mcp.json`   |

- **Per-harness instructions:** `instructions.<harness>.md` (e.g. `instructions.claude.md`)
  overrides the shared `instructions.md` for that harness only.
- **Shared `AGENTS.md`:** Codex and Pi both use the project `AGENTS.md` standard, so they
  emit a byte-identical file. `relay build` fails loudly if per-harness overrides make
  them diverge.
- **Session inject:** when a session is active, `relay build` weaves a pointer to
  `.relay/sessions/<id>/HANDOFF.md` into each harness's instruction file.

## MCP formats

| Harness | File                 | Format            | Transform                     |
| ------- | -------------------- | ----------------- | ----------------------------- |
| Claude  | `.mcp.json`          | JSON `mcpServers` | `toClaudeJson` / `fromClaudeJson` |
| Cursor  | `.cursor/mcp.json`   | JSON `mcpServers` | `toCursorJson` / `fromCursorJson` |
| Codex   | `.codex/config.toml` | TOML tables       | `toCodexToml` / `fromCodexToml`   |
| Pi      | `mcp.json`           | JSON `mcpServers` | `toClaudeJson`                |

All transforms round-trip (`from(to(x)) === x`) — verified in
`packages/adapters/src/mcp-transform.test.ts`.

## Manifest ownership & drift

`relay build` records every generated file's SHA-256 in `relay.lock`. `relay doctor`
recomputes them and reports:

- **modified** — a generated file's bytes changed (hand-edited).
- **missing** — a tracked file was deleted.

Re-run `relay build` to regenerate, or move the change into `relay/`.

## Scopes

- **Pi global:** `relay build --pi-global` writes Pi's files to `~/.pi` instead of the
  project (opt-in; never silent). Global files are not tracked in `relay.lock`.

## Golden tests

Each harness has a committed golden fixture in `fixtures/golden/<harness>/`. Regenerate
after an intentional adapter change:

```bash
UPDATE_GOLDEN=1 pnpm --filter @relay/adapters test
```
