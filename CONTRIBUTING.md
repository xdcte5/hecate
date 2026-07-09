# Contributing

## Team split

| Dev A — Mesh Brain | Dev B — Harness Fabric |
|--------------------|------------------------|
| `packages/schema` (session/rhp/registry types) | `packages/schema` (adapter/manifest types) |
| `packages/registry` | `packages/adapters` |
| `packages/session` | `packages/mcp` |
| `packages/cli` session/registry/handoff/trace | `packages/cli` init/build/watch/doctor/mcp |

**Rule:** Dev A does not edit `packages/adapters/`. Dev B does not edit `packages/session/` or `packages/registry/`.

## Dev A status

Dev A (Mesh Brain) Sprints 1–4 are **complete**. Dev B can integrate against the frozen `SessionStore` API:

```typescript
SessionStore.start() / getActive() / get()
SessionStore.recordDecision() / recordProgress() / prepareHandoff()
getHandoffPath(sessionId) → ".relay/sessions/<id>/HANDOFF.md"
```

## Branches

- `dev-a/sprint-N`
- `dev-b/sprint-N`

Merge every 2 weeks with integration smoke:

```bash
cd fixtures/minimal-relay
relay registry list
relay session start test
```
