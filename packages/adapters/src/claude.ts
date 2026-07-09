import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toClaudeJson } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Claude Code adapter.
 *
 * | Concern      | Output                    |
 * | ------------ | ------------------------- |
 * | Instructions | `CLAUDE.md`               |
 * | Subagents    | `.claude/agents/<name>`   |
 * | Skills       | `.claude/skills/<name>`   |
 * | Commands     | `.claude/commands/<name>` |
 * | MCP          | `.mcp.json`               |
 */
export class ClaudeAdapter extends BaseAdapter {
  readonly harness: HarnessId = "claude-code";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    const injectHeader = ctx.handoffPointer
      ? `> **Active session:** read @${ctx.handoffPointer} first for current context.`
      : null;

    files.push({
      path: "CLAUDE.md",
      content: this.joinSections(injectHeader, this.instructionsFor(source)),
    });

    for (const agent of source.agents) {
      files.push({ path: `.claude/agents/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `.claude/skills/${skill.name}`, content: skill.content });
    }
    for (const command of source.commands) {
      files.push({ path: `.claude/commands/${command.name}`, content: command.content });
    }

    if (source.mcp) {
      files.push({ path: ".mcp.json", content: toClaudeJson(source.mcp) });
    }

    return files;
  }
}
