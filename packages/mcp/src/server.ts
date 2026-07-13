import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  handoffPrepare,
  registryList,
  sessionGet,
  sessionRecordDecision,
  sessionRecordProgress,
  type ToolContext,
} from "./tools.js";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});

/**
 * Build the relay-mcp server for a project root. Exposes the five mesh-fabric
 * tools that call into the Mesh Brain packages. Transport-agnostic — the bin
 * wires it to stdio.
 */
export function createRelayMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "relay-mcp", version: "0.1.0" });

  server.registerTool(
    "session_get",
    {
      title: "Get session",
      description: "Return the active Product Session (or a specific one by id).",
      inputSchema: { sessionId: z.string().optional() },
    },
    async ({ sessionId }) => jsonResult(await sessionGet(ctx, { sessionId })),
  );

  server.registerTool(
    "session_record_decision",
    {
      title: "Record decision",
      description: "Append a decision to the session; logged to events.jsonl.",
      inputSchema: {
        text: z.string(),
        rationale: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ text, rationale, sessionId }) =>
      jsonResult(await sessionRecordDecision(ctx, { text, rationale, sessionId })),
  );

  server.registerTool(
    "session_record_progress",
    {
      title: "Record progress",
      description: "Record work progress for the active harness on the session.",
      inputSchema: {
        summary: z.string().optional(),
        filesTouched: z.array(z.string()).optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ summary, filesTouched, sessionId }) =>
      jsonResult(await sessionRecordProgress(ctx, { summary, filesTouched, sessionId })),
  );

  server.registerTool(
    "handoff_prepare",
    {
      title: "Prepare handoff",
      description: "Build an RHP handoff bundle targeting a harness.",
      inputSchema: {
        to: z.enum(["claude-code", "codex", "cursor", "pi", "antigravity"]),
        sessionId: z.string().optional(),
      },
    },
    async ({ to, sessionId }) => jsonResult(await handoffPrepare(ctx, { to, sessionId })),
  );

  server.registerTool(
    "registry_list",
    {
      title: "List harnesses",
      description: "Return the Harness Card registry.",
      inputSchema: {},
    },
    async () => jsonResult(await registryList(ctx)),
  );

  return server;
}
