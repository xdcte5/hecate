# Security Guide

Relay is designed **local-first, inspectable, and network-silent by default**. This document explains the trust model for the Mesh Brain layer (Dev A) and what Dev B must preserve in adapters/MCP.

---

## Core principles

| Principle | Implementation |
|-----------|------------------|
| **Local-only default** | No network calls in OSS Mesh Brain (`packages/schema`, `registry`, `session`, `cli`) |
| **Inspectable state** | All session data in `.relay/sessions/<id>/` as JSON + JSONL + Markdown |
| **Append-only audit** | `events.jsonl` — every mutation logged with timestamp |
| **Read-only transcript import** | Copies from `~/.claude`, `~/.codex`, `.cursor` — never mutates native stores |
| **Deterministic routing** | OSS `--to auto` uses regex rules only; no silent LLM routing |
| **Atomic writes** | Session files written via temp + rename (ide-bridge pattern) |

---

## What lives on disk

```
.relay/sessions/<id>/
├── session.json      # RHP manifest (mode 600)
├── handoff.json      # Machine handoff bundle
├── HANDOFF.md        # Human handoff (agents read this)
├── events.jsonl      # Audit log
└── transcripts/      # Read-only copies from harness stores

relay/
├── relay.yaml        # activeSessionId pointer
├── registry.yaml     # Harness Cards (public config)
└── session-policy.yaml  # Routing + governance rules
```

**Default:** `.relay/` is in `.gitignore`. Session state stays local unless you explicitly commit it.

---

## File permissions

Session directories are created with mode `0700`. Session files use mode `0600` (atomic write from ide-bridge vendor code).

---

## Governance controls

From `relay/session-policy.yaml`:

```yaml
governance:
  requireGitSnapshotOnHandoff: true   # blocks handoff without git commit
  maxHandoffTokens: 8000              # budget for HANDOFF.md (future enforce)
  maxTranscriptLines: 200             # mechanical trim limit on import
```

| Control | Purpose |
|---------|---------|
| `requireGitSnapshotOnHandoff` | Ensures handoff includes reproducible git state |
| `maxHandoffTokens` | Prevents runaway context bundles |
| `maxTranscriptLines` | Bounds transcript import size |

---

## Threat model (MVP scope)

### In scope

| Risk | Mitigation |
|------|------------|
| Session file tampering | `relay doctor --session` validates RHP schema |
| Stale handoff bundles | `handoffSeq` increments; doctor checks file presence |
| Accidental secret commit | `.relay/` gitignored by default |
| Non-deterministic routing | OSS path has zero LLM calls |
| Prototype pollution in merge | `merge.ts` blocks `__proto__` keys (ide-bridge) |

### Out of scope (MVP)

| Risk | Status |
|------|--------|
| MCP tool sandboxing | Dev B Sprint 3 — relay-mcp allowlists planned |
| Multi-user access control | Team tier (Pro) |
| Network exfiltration via adapters | Dev B must not add phone-home |
| Encrypted session storage | Plain JSON by design (grep-able) |

---

## Pro tier security notes

| Feature | Gate | Notes |
|---------|------|-------|
| `--smart` handoff | Pro ($19/mo) | Single LLM call returns harness id only; no chain-of-thought stored |
| `--otel` trace export | Pro | Opt-in export; OSS `relay trace` stays local stdout |
| Team sync | Pro | Session state via git — same trust model as code |

Pro features exit with a clear message in OSS builds:

```bash
relay handoff --to auto --smart   # → "Coming in v0.2 (Pro tier)"
relay trace --otel                # → "Coming in v0.2 (Pro tier)"
```

---

## Recommendations for operators

1. **Keep `.relay/` gitignored** unless you intend to share session state.
2. **Run `relay doctor --session`** after every handoff in CI or scripts.
3. **Run `relay doctor --kpi`** before demos to verify tier-1 metrics.
4. **Review `events.jsonl`** when debugging — it is the source of truth.
5. **Do not enable `--smart`** until you trust the Pro tier data handling policy.

---

## Dev B contract (security requirements)

When implementing adapters and MCP, Dev B must:

- Never mutate `~/.claude`, `~/.codex`, or native harness stores (read-only import only)
- Never make network calls from adapter build without explicit opt-in
- Use `relay.lock` checksums so `relay doctor` can detect drift
- Scope Pi writes explicitly (`--pi-scope`) — never silently write `~/.pi/agent/`

---

## Reporting

For security issues in Relay OSS, open a private disclosure via GitHub Security Advisories once the repo is public.
