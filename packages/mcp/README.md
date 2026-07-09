# @relay/mcp

`relay-mcp` — the local **stdio** MCP mesh fabric. It exposes Relay's Product Session
and registry to any MCP-capable harness as tools, and logs every mutation through the
Mesh Brain's `events.jsonl` audit trail. No HTTP daemon (Solo agentgateway pattern is
deferred to a future Team tier).

## Tools

| Tool                       | Calls into            | Effect                                    |
| -------------------------- | --------------------- | ----------------------------------------- |
| `session_get`              | `@relay/session`      | Return the active (or given) session      |
| `session_record_decision`  | `@relay/session`      | Append a decision → `events.jsonl`        |
| `session_record_progress`  | `@relay/session`      | Record progress for the active harness    |
| `handoff_prepare`          | `@relay/session`      | Build an RHP handoff bundle for a target  |
| `registry_list`            | `@relay/registry`     | Return the Harness Card registry          |

Tool handlers live in `tools.ts` as plain async functions (SDK-free, unit-tested).
`server.ts` wraps them with `@modelcontextprotocol/sdk`; `bin.ts` connects the server to
`StdioServerTransport`.

## Run

```bash
relay mcp install   # write MCP config (incl. a `relay` server) into all 4 harnesses
relay mcp list      # show the merged virtual surface (servers + built-in tools)
relay-mcp           # start the stdio server (harnesses launch this for you)
```

Any harness that launches `relay-mcp` can then read and mutate the shared session — a
decision recorded from Claude shows up in the next handoff prepared from Cursor.
