# Dev B — Harness Fabric track

This is the working map for the **Harness Fabric** side of Relay: adapters, the build
pipeline, the MCP mesh fabric, and golden tests. It mirrors the sprint plan in
`theplan.txt` but is compressed into a 2-day parallel execution (the 4-week timeline is
ignored — sprints are executed back to back, each pushed to `madhav` on completion).

## Ownership boundary

Dev B owns and edits:

- `packages/schema` — **adapter/manifest types only** (`AdapterManifest`, `RelayLock`)
- `packages/adapters` — the `Adapter` interface, base class, and 4 harness adapters
- `packages/mcp` — `relay-mcp` stdio server
- `packages/cli` — `init`, `build`, `watch`, `doctor` (drift), `migrate`, `mcp *`

Dev B does **not** edit `packages/session/` or `packages/registry/`. Cross-package calls
go through `@relay/schema` types (and the read-only `SessionStore` API for inject).

## Sprint map

Legend: ☐ pending · ◐ in progress · ☑ done

### Sprint 1 — Adapter foundation + Claude/Codex

- ☑ `packages/schema`: `AdapterManifest` + `RelayLock` Zod types (Week 0 stub, now real)
- ☑ `packages/adapters`: `Adapter` interface + `BaseAdapter` (documented in README)
- ☑ `packages/adapters`: manifest writer + `relay.lock` sha-256 checksums
- ☑ Claude Code adapter → golden test in `fixtures/golden/claude/`
- ☑ Codex adapter → golden test in `fixtures/golden/codex/`
- ☑ CLI: `relay init` (detects installed binaries), `relay build`, `relay doctor` drift check

**Exit:** `relay init && relay build --harness claude` produces valid output; doctor is clean.

### Sprint 2 — Cursor/Pi + session inject + watch

- ☐ Cursor adapter (`.cursor/rules/main.mdc`, mcp, skills) → golden test
- ☐ Pi adapter (project scope + `--pi-global` flag) → golden test
- ☐ Session inject hook in all 4 adapters (HANDOFF.md pointer in generated outputs)
- ☐ `packages/adapters/mcp-transform.ts` stub (Claude JSON shape defined)
- ☐ CLI: `relay watch` (rebuilds on `relay/` changes)

**Exit:** `relay build --all` injects the active session HANDOFF pointer into all 4 harnesses.

### Sprint 3 — MCP mesh fabric

- ☐ `packages/mcp`: `relay-mcp` stdio server (no HTTP daemon)
- ☐ MCP tools: `session_get`, `session_record_decision`, `session_record_progress`,
  `handoff_prepare`, `registry_list` (call into `@relay/session` / `@relay/registry`)
- ☐ `mcp-transform.ts` full — Claude JSON ↔ Codex TOML ↔ Cursor JSON round-trip tests
- ☐ CLI: `relay mcp install`, `relay mcp list` (virtual merged surface)
- ☐ `relay migrate --from agents-md`
- ☐ Golden tests for MCP config output per harness

**Exit:** `session_record_decision` via MCP lands in `events.jsonl` and the next handoff.

### Sprint 4 — Integration + docs

- ☐ `relay migrate --from harness` (Claude/Codex layout → `relay/`)
- ☐ `docs/adapter-matrix.md` + per-adapter READMEs
- ☐ `docs/quickstart.md` (< 15 min first handoff)
- ☐ E2E: session → handoff (Dev A) → build → inject visible in all harnesses

**Exit:** fresh user completes a handoff in < 15 min; adapters round-trip cleanly.

## Golden-test discipline (Eng review, mandatory)

Each adapter gets a fixture repo + committed golden output **before the next adapter
starts**. A golden test transpiles `fixtures/minimal-relay/relay/` and diffs generated
files byte-for-byte against `fixtures/golden/<harness>/`. Regenerate with
`UPDATE_GOLDEN=1 pnpm --filter @relay/adapters test`.
