# Relay → Pi-Like Harness Plan

> Goal: **Launch `relay` once, type normal English prompts, Relay plans + runs agents automatically** — with a Pi-quality TUI and real tool-loop execution, while keeping Relay’s unique multi-agent mesh (Claude / Codex / Cursor / Pi routing).

**Reference:** [earendil-works/pi — `packages/coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)  
**Relay today:** mesh brain + `@relay/orchestrator` chat (spawn external CLIs, exit-code success only)  
**Gap:** Relay is a **router + context broker**, not a **coding harness runtime** like Pi.

---

## 1. What Pi Actually Is (clone findings)

Pi is **not** a wrapper around `claude` or `codex` CLI. It is three packages:

| Package | Role |
|---------|------|
| `pi-agent-core` | Tool loop: LLM → tool calls → results → next turn |
| `pi-ai` | Multi-provider LLM streaming (30+ providers) |
| `pi-coding-agent` | Harness: sessions, tools, extensions, TUI, SDK, RPC |

### Pi patterns Relay should copy

| Pi capability | Pi location | Relay today |
|---------------|-------------|-------------|
| **Mode-agnostic core** | `AgentSession` shared by TUI / print / JSON / RPC | `processPrompt` only spawns subprocess |
| **Tool loop** | `read`, `edit`, `write`, `bash`, `grep`… | None — agents must self-loop |
| **Streaming TUI** | `pi-tui` + `interactive-mode.ts` | Plain readline + line logs |
| **Tree sessions** | JSONL with `parentId`, `/tree`, fork | RHP flat session + handoff files |
| **Steering / follow-up** | Queue messages while agent runs | Blocked with “still working…” |
| **Compaction + retry** | Auto on context overflow | None |
| **Extensions** | `registerTool`, `before_agent_start`, UI hooks | `relay/` → adapters only |
| **Skills / prompts** | `~/.pi/agent/skills`, `/skill:name` | `relay/skills/` transpiled, not executed |
| **Verification** | Tools + bash output in loop | Exit code only |
| **RPC / SDK embed** | `createAgentSession()`, `--mode rpc` | `execFileSync` one-shot |

### What Pi deliberately does *not* bake in (extensions instead)

- MCP (via `pi-mcp-adapter` package)
- Sub-agents (extension: `examples/extensions/subagent/`)
- Plan mode (extension: `examples/extensions/plan-mode/`)
- Permission popups

**Relay should stay thin on these** — but must own **multi-harness routing**, which Pi does not.

---

## 2. Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  relay chat (Pi-like TUI)                                   │
│  you › "build a login page"                                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  @relay/orchestrator (mesh conductor)                       │
│  · decompose goal → steps                                   │
│  · ThinRouter picks harness per step                        │
│  · verify gates (test/lint/diff) between steps              │
│  · update RHP session after each step                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Pi harness    │  │ Claude Code   │  │ Codex         │
│ (SDK/RPC)     │  │ (CLI/RPC)     │  │ (CLI)         │
│ primary loop  │  │ routed steps  │  │ test steps    │
└───────────────┘  └───────────────┘  └───────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  RHP session (.relay/sessions/) + relay-mcp tools             │
└─────────────────────────────────────────────────────────────┘
```

**Principle:** Relay orchestrates; **Pi (or Pi-compatible runtime) executes the tool loop** for implement steps. Other harnesses remain routed workers for specialized steps (tests, architecture).

---

## 3. Current Relay Gaps (priority order)

| # | Gap | Blocks Pi-like UX |
|---|-----|-------------------|
| 1 | No tool loop — only spawns CLI | Agent can’t build files unless CLI does everything |
| 2 | Success = exit code | False positives/negatives |
| 3 | No post-run session update | Next step gets stale context |
| 4 | No verification gates | Codex runs tests before code exists |
| 5 | TUI is readline logs | No tool transcript, tokens, model footer |
| 6 | No steering while running | User can’t interrupt/refine mid-run |
| 7 | Pi invoked as `pi <prompt>` | Wrong API — need `-p` / RPC / SDK |
| 8 | No structured harness result | Can’t replan on failure |
| 9 | Dash and chat diverge | Two UXes, neither complete |
| 10 | `maxHandoffTokens` not enforced | Context bloat |

---

## 4. Phased Roadmap

### Phase 1 — **Pi RPC harness driver** (2–3 weeks)

**Outcome:** `relay` chat runs Pi’s real agent loop for implement steps.

| Task | Details | Relay files |
|------|---------|-------------|
| 1.1 Add Pi RPC client | Spawn `pi --mode rpc`, JSONL stdin/stdout protocol | `packages/orchestrator/src/drivers/pi-rpc.ts` |
| 1.2 Structured result schema | `{ ok, filesChanged, summary, decisions, error }` | `packages/schema/src/harness-result.ts` |
| 1.3 Replace `runHarnessAuto` for Pi | RPC session per step, stream events to chat | `auto-run.ts`, `process-prompt.ts` |
| 1.4 Post-run hooks | `importTranscripts` + git diff → `recordProgress` | `process-prompt.ts`, `session/store.ts` |
| 1.5 Verification gate | `pnpm test` / `git diff --stat` before next step | `packages/orchestrator/src/verify.ts` |
| 1.6 Fix step ordering | Don’t advance to test step if implement produced no files | `process-prompt.ts` |

**Pi reference files:**
- `/packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- `/packages/coding-agent/src/core/sdk.ts`
- `/packages/coding-agent/docs/sdk.md`

**Exit criteria:**
```bash
relay
you › add user login page
# → Pi RPC runs, creates files, relay shows tool events, advances to Codex only if files exist
```

---

### Phase 2 — **Pi-like TUI** (2–3 weeks)

**Outcome:** Chat feels like Pi/Codex/Claude Code — not a command bar.

| Task | Details | Relay files |
|------|---------|-------------|
| 2.1 Event stream renderer | Map harness events → message/tool/bash components | `packages/cli/src/tui/components/` |
| 2.2 Footer bar | model, step N/M, harness, context % | `packages/cli/src/tui/footer.ts` |
| 2.3 Steering input | Allow typing while running (steer queue) | `chat.ts` + orchestrator queue |
| 2.4 Collapsible tool output | Ctrl+O style tool blocks | port pattern from `pi-tui` |
| 2.5 Unify dash into chat | Deprecate separate `run-dash` command UX | `chat.ts` absorbs run plan panel |
| 2.6 `@file` and `!cmd` in editor | Match Pi editor affordances | `packages/cli/src/tui/editor.ts` |

**Pi reference:**
- `/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `/packages/tui/`

**Exit criteria:** User sees live tool calls, file edits, and bash output inside `relay` without opening another terminal.

---

### Phase 3 — **Multi-agent mesh loop** (3–4 weeks)

**Outcome:** One NL prompt → Relay auto-relays across harnesses like the original vision.

| Task | Details |
|------|---------|
| 3.1 Harness driver interface | `HarnessDriver { run(step), streamEvents(), cancel() }` |
| 3.2 Drivers: Pi RPC, Claude `-p`, Codex `exec` | `packages/orchestrator/src/drivers/` |
| 3.3 LLM planner (optional OSS heuristic + Pro `--smart`) | Replace fixed implement→test template |
| 3.4 Replan on failure | Retry, swap harness via failover, split step |
| 3.5 Subagent pattern | Port Pi `subagent` idea: Relay spawns child harness for subtask |
| 3.6 Auto `relay build` + handoff between steps | Already partial — make mandatory |

**Pi reference:**
- `/packages/coding-agent/examples/extensions/subagent/`
- `/packages/coding-agent/examples/extensions/plan-mode/`

**Exit criteria:**
```
you › build portfolio site with auth and tests
relay › Plan: Claude (scaffold) → Cursor (UI) → Codex (tests)
relay › [runs all automatically, no manual next/done/handoff]
```

---

### Phase 4 — **Relay extensions & skills runtime** (2–3 weeks)

**Outcome:** `relay/skills/`, `relay/agents/` execute inside the loop (not just transpile).

| Task | Details |
|------|---------|
| 4.1 Load `relay/skills/*.md` as Pi skills | Wire `resource-loader` pattern |
| 4.2 `relay/agents/*.md` as slash commands or sub-harnesses | `/review`, `/ship` |
| 4.3 `relay-mcp` tools auto-installed in Pi session | `relay mcp install` → Pi RPC env |
| 4.4 Extension slot for community packages | `relay install npm:...` (mirror `pi install`) |

**Pi reference:**
- `/packages/coding-agent/src/core/skills.ts`
- `/packages/coding-agent/src/core/resource-loader.ts`

---

### Phase 5 — **Production hardening** (ongoing)

| Task | Details |
|------|---------|
| 5.1 Sandbox / container docs | Pi `containerization.md` patterns for Relay |
| 5.2 `maxHandoffTokens` enforcement | Trim handoff + transcripts |
| 5.3 OTel events (`relay trace --otel`) | Pro tier |
| 5.4 Live mesh heartbeat (v0.3) | See `docs/agent-mesh-mapping.md` |
| 5.5 E2E: mock harness drivers | Full prompt → files → test green |

---

## 5. What NOT to Build (stay Pi-like by being minimal)

| Don’t build in Relay core | Do instead |
|---------------------------|------------|
| Full LLM provider layer | Delegate to Pi `pi-ai` or harness CLIs |
| 30+ provider OAuth | Pi handles auth for Pi path; harness CLIs for others |
| Duplicate tool implementations | Use Pi tools via RPC or harness-native tools |
| MCP server inside Relay loop | Keep `relay-mcp`; Pi loads via extension |
| Permission popup system | Document containerization; optional extension later |

Relay’s **unique value** is the **mesh**: session continuity + routing + governance across 4 harnesses. Pi’s unique value is the **runtime**. **Compose them, don’t merge into one blob.**

---

## 6. Recommended default path (decision)

**Adopt “Pi as primary implement driver, ThinRouter for specialists”:**

| Step type | Default harness | Driver |
|-----------|-----------------|--------|
| Implement / feature | `pi` (fallback: `claude-code`) | Pi RPC |
| Frontend polish | `cursor` | `cursor-agent -p` or manual+IDE detect |
| Unit tests | `codex` | `codex exec --full-auto` |
| Architecture review | `claude-code` | `claude -p` |
| Scripts / automation | `pi` | Pi RPC |

Update `packages/orchestrator/src/plan.ts` and `relay/session-policy.yaml` accordingly.

---

## 7. Package structure after Phase 1–3

```
packages/
├── orchestrator/
│   ├── src/
│   │   ├── drivers/
│   │   │   ├── types.ts          # HarnessDriver interface
│   │   │   ├── pi-rpc.ts         # Pi JSONL RPC
│   │   │   ├── claude.ts
│   │   │   └── codex.ts
│   │   ├── process-prompt.ts     # auto mesh loop
│   │   ├── verify.ts             # test/lint gates
│   │   └── planner.ts            # step decomposition (Phase 3)
├── cli/
│   └── src/tui/
│       ├── chat.ts               # main REPL
│       ├── components/           # tool/message renderers (Phase 2)
│       └── footer.ts
└── schema/
    └── src/harness-result.ts     # structured step results
```

---

## 8. Immediate next sprint (start here)

**Sprint: Pi RPC driver + verification gate**

1. Read Pi RPC protocol: `packages/coding-agent/src/modes/rpc/rpc-types.ts`
2. Implement `PiRpcDriver` with event streaming callback
3. Wire `processPrompt` implement steps → Pi RPC (not `spawn pi prompt`)
4. Add `verifyStep()` — `git diff --quiet` + optional `pnpm test`
5. Block test step if zero files changed in implement step
6. Update chat to print Pi RPC events (`tool_start`, `tool_end`, `message`)

**Definition of done:**
- `relay` + NL prompt creates real files in `sample-app`
- User sees streaming progress (not silent “working…”)
- Codex test step only runs after implement step produced code

---

## 9. Success metrics (Pi parity checklist)

| Metric | Pi | Relay target |
|--------|----|--------------|
| Launch once, NL only | ✅ | ✅ `relay` |
| Tool loop executes files | ✅ | ✅ via Pi RPC (Phase 1) |
| See tools live in TUI | ✅ | Phase 2 |
| Steering while running | ✅ | Phase 2 |
| Session tree / fork | ✅ | Optional — RHP handoff is enough for v1 |
| Multi-provider routing | ✅ (models) | ✅ (harnesses) — Relay differentiator |
| Extensions | ✅ | Phase 4 |
| Zero manual `handoff`/`next`/`done` | ✅ | Phase 3 |

---

## 10. References

- Pi monorepo: https://github.com/earendil-works/pi
- Pi coding agent: `packages/coding-agent/README.md`
- Pi SDK: `packages/coding-agent/docs/sdk.md`
- Pi RPC: `packages/coding-agent/src/modes/rpc/`
- Relay mesh mapping: `docs/agent-mesh-mapping.md`
- Relay orchestrator: `packages/orchestrator/src/process-prompt.ts`
