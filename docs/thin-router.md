# Thin Router

Relay's **Thin Router** picks the next harness for `relay handoff --to auto` using deterministic rules — no LLM calls in OSS.

## Routing stages

The router evaluates a task (the active session goal) in order:

1. **Routing rules** — regex patterns in `relay/session-policy.yaml` (`routing[]`). First match wins.
2. **Strength match** — scores Harness Card `strengths` from `relay/registry.yaml` against the goal text. Ties break using `failover` order.
3. **Failover** — uses the first harness in `failover` when nothing else matches.

Each selection returns a reason: `routing-rule`, `strength-match`, or `failover`.

## OSS vs Pro

| Mode | Command | Behavior |
|------|---------|----------|
| OSS | `relay handoff --to auto` | Regex + Harness Cards + failover (this doc) |
| Pro | `relay handoff --to auto --smart` | Deferred — LLM-assisted routing planned for Pro |

## Fixture examples

From `fixtures/minimal-relay/relay/session-policy.yaml`:

| Goal | Harness | Reason |
|------|---------|--------|
| `fix React component` | `cursor` | `routing-rule` — `(?i)(react\|component\|jsx\|tsx\|frontend)` |
| `write unit tests` | `codex` | `routing-rule` — `(?i)(unit test\|write tests\|vitest\|jest\|mocha)` |
| `refactor module layout` | `claude-code` | `routing-rule` — `(?i)(refactor\|architecture\|system design)` |
| `build cli tool` | `pi` | `routing-rule` — `(?i)\b(script\|automation\|cli\|shell)\b` |
| `do something vague` | `cursor` | `failover` — first entry in `failover` |

Strength fallback example: `explain typescript generics` → `codex` via the `typescript` strength on the Codex card.

## Session policy governance

Optional `governance` block in `session-policy.yaml`:

```yaml
governance:
  requireGitSnapshotOnHandoff: true
  maxHandoffTokens: 8000
  maxTranscriptLines: 200
```

- **requireGitSnapshotOnHandoff** — handoff fails if no git snapshot can be captured.
- **maxHandoffTokens** — budget for handoff bundle size (used by downstream trim logic).
- **maxTranscriptLines** — passed to transcript import before handoff.

## Configuration files

| File | Purpose |
|------|---------|
| `relay/registry.yaml` | Harness Cards (`strengths`, `weaknesses`, `binaries`) |
| `relay/session-policy.yaml` | Routing rules, failover order, governance |

## CLI usage

```bash
cd fixtures/minimal-relay
relay session start "fix React component"
relay handoff --to auto
```

Example output:

```
Auto-routed to: cursor
Reason: routing-rule (pattern: (?i)(react|component|jsx|tsx|frontend))
Handoff prepared for: cursor
Session: <session-id>
Handoff #1
Files:
  .relay/sessions/<session-id>/HANDOFF.md
  .relay/sessions/<session-id>/handoff.json
```
