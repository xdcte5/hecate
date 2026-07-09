#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRelayMcpServer } from "./server.js";

async function main(): Promise<void> {
  const server = createRelayMcpServer({ rootDir: process.cwd() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until stdin closes. Keep stderr for logs; stdout is the
  // MCP channel and must stay clean.
  process.stderr.write("relay-mcp: stdio server ready\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`relay-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
