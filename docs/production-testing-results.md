# Production Testing Results

Date: 2026-08-09

## Environment

- Repo: `/Users/shaynavinoth/projects/relay`
- Node: `/Users/shaynavinoth/.nvm/versions/node/v22.23.1/bin/node`
- CLI under test: `packages/cli/dist/index.js`
- Smoke roots:
  - `/private/tmp/relay-prod-check`
  - `/private/tmp/relay-prod-check-codexdefault`
  - `/private/tmp/relay-prod-check-claudeonly`

## Results

| # | Check | Result | Evidence |
|---|---|---:|---|
| 1 | `pnpm build` | PASS | TypeScript build passed across workspace packages. |
| 2 | `pnpm test` | PASS | Full workspace test suite passed: 426 tests passed, 1 skipped. |
| 3 | `relay init` | PASS | `relay init --all-harnesses` completed in temp smoke roots. |
| 4 | `relay doctor` | PASS | Passed after `relay build --all` generated `relay.lock`. |
| 5 | `relay doctor --routing` | PASS | Command runs and reports diagnostics; no local routing history in fresh temp root. |
| 6 | Trivial `hello.sh` task | PASS | `hello.sh` created, executable, and prints `hello`. |
| 7 | Multi-step chat | PASS | Active-session smoke planned 2 steps and created `math.js` plus `math.test.js`; `node --test math.test.js` passed. |
| 8 | Handoff | PASS | `relay handoff --to codex` generated readable `HANDOFF.md` and `handoff.json` for the active session. |
| 9 | `relay trace` shows hops + failoverReason | PASS | Trace groups route and stats hops; hop events are wrapped as trace records. |
| 10 | `.relay/routing-stats.jsonl` captures costs | PARTIAL | Claude capture includes `costUsd`; Codex default capture records tokens but no cost. |
| 11 | No Pi spawn when Pi is not eligible or not selected | PASS | Explicit `--agents claude-code,codex` produced `pi_rpc_count=0`. |
| 12 | Trivial latency <= 1.5x direct Claude | PASS | Claude-only Relay path: 23.37s. Existing direct Claude baseline: ~17.7s; threshold: ~26.6s. |
| 13 | Live E2E on real repo | PENDING | Not exercised in this dry run. |
| 14 | Resume after kill | PASS | Controlled smoke left a step in `running` state, then `relay run --resume` relaunched that same durable step. |
| 15 | No secrets in events/logs | PASS | Focused scan of latest `.relay` artifacts and smoke logs found 0 matches for common secret patterns. |

## Fixes From This Dry Run

- Explicit enabled agents are now authoritative; Relay no longer re-adds installed harnesses that were not selected.
- Codex launch args include `--skip-git-repo-check`, so temp-directory smokes do not fail trust checks.
- Automatic Codex model routing now defers to the local Codex CLI default instead of forcing stale registry IDs such as `o3`.
- Handoff git snapshots now include untracked files, so newly generated agent artifacts are visible in `HANDOFF.md`.

## Notes

- Codex default execution succeeded without forced model selection, but was slow in this environment because the local Codex skill workflow loaded a very large prompt/tool context. This is agent-side latency after Relay launch, not Relay mesh preamble overhead.
- Claude-only trivial execution is the relevant V0 latency check from the handoff doc and currently passes.
