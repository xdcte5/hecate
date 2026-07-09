# @relay/adapters

Harness Fabric core — transpiles the canonical `relay/` source into each harness's
native file layout, and owns the `relay.lock` manifest that lets `relay doctor` detect
drift in generated files.

## Model

```
relay/  ──readRelaySource()──▶  RelaySource  ──Adapter.generate()──▶  GeneratedFile[]
                                                                          │
                                                    writeGeneratedFiles() ▼
                                              CLAUDE.md / AGENTS.md / … + relay.lock
```

- **`RelaySource`** — the parsed `relay/` directory (instructions, agents, skills,
  commands, `mcp.json`). Read once, handed to every adapter.
- **`Adapter`** — `generate(source, ctx) => GeneratedFile[]`. Pure: same input ⇒ same
  files in deterministic order (required for golden tests).
- **`BaseAdapter`** — shared helpers (`instructionsFor`, `joinSections`). Concrete
  adapters extend it and implement `generate`.
- **`BuildContext`** — cross-cutting build input; carries the active session's
  `handoffPointer` for session inject (Sprint 2).

## Writing an adapter

```ts
import { BaseAdapter, type BuildContext, type GeneratedFile } from "@relay/adapters";
import type { HarnessId } from "@relay/schema";

export class MyAdapter extends BaseAdapter {
  readonly harness: HarnessId = "cursor";
  generate(source, ctx: BuildContext): GeneratedFile[] {
    return [{ path: ".cursor/rules/main.mdc", content: this.instructionsFor(source) }];
  }
}
```

Register it in `build.ts`'s `ADAPTERS` map, add a golden fixture, done.

## Manifest & drift

`relay build` records every generated file's sha-256 in `relay.lock`. `detectDrift()`
recomputes the checksums against disk and reports `missing` or `modified` files, which
`relay doctor` surfaces. Humans edit `relay/`, never the generated output.

## Adapter matrix

| Harness     | Instructions | Subagents / Skills            | MCP                  |
| ----------- | ------------ | ----------------------------- | -------------------- |
| Claude Code | `CLAUDE.md`  | `.claude/agents`, `.claude/skills`, `.claude/commands` | `.mcp.json` |
| Codex       | `AGENTS.md`  | `.codex/skills`               | `.codex/config.toml` |
| Cursor      | _Sprint 2_   | _Sprint 2_                    | _Sprint 2_           |
| Pi          | _Sprint 2_   | _Sprint 2_                    | _Sprint 2_           |

## Golden tests

Golden fixtures live in `fixtures/golden/<harness>/`. Regenerate after an intentional
adapter change:

```bash
UPDATE_GOLDEN=1 pnpm --filter @relay/adapters test
```
