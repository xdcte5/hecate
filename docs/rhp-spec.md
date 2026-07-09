# Relay Handoff Protocol (RHP) v1

Adapted from ide-bridge Portable Context Bundle (MIT). Stored at `.relay/sessions/<id>/`.

## Files

| File | Purpose |
|------|---------|
| `session.json` | Canonical RHP manifest |
| `handoff.json` | Machine bundle for next harness |
| `HANDOFF.md` | Human-readable handoff (agents read this) |
| `events.jsonl` | Append-only audit log |

## session.json fields

- `rhp_version`: `"1"`
- `sessionId`, `goal`, `status`, `activeHarness`
- `decisions[]`, `todos[]`, `agents{}`, `git`
- `handoffSeq`: increments on each handoff

## handoff.json fields

Machine bundle produced by `relay handoff --to <harness>`:

- `targetHarness`, `sourceHarness`, `handoffSeq`, `prepared_at`
- `goal`, `decisions[]`, `todos[]`, `git` snapshot

## relay.yaml

Project config at `relay/relay.yaml`:

- `version`: `"1"`
- `activeSessionId`: current product session (synced on `session start`)

See `@relay/schema` for full Zod definitions (`RhpV1Schema`, `HandoffBundleSchema`).
