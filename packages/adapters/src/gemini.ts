import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toClaudeJson } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Gemini CLI adapter.
 *
 * | Concern      | Output                      |
 * | ------------ | --------------------------- |
 * | Instructions | `GEMINI.md`                 |
 * | Subagents    | `.gemini/agents/<name>`     |
 * | Skills       | `.gemini/skills/<name>`     |
 * | Commands     | `.gemini/commands/<name>`   |
 * | MCP          | `.gemini/settings.json`     |
 *
 * Gemini reads project context from `GEMINI.md` and configuration (incl.
 * `mcpServers`, same JSON shape as Claude) from `.gemini/settings.json`.
 */
export class GeminiAdapter extends BaseAdapter {
  readonly harness: HarnessId = "gemini-cli";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    const injectHeader = ctx.handoffPointer
      ? `> **Active session:** read \`${ctx.handoffPointer}\` first for current context.`
      : null;

    files.push({
      path: "GEMINI.md",
      content: this.joinSections(injectHeader, this.instructionsFor(source)),
    });

    for (const agent of source.agents) {
      files.push({ path: `.gemini/agents/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `.gemini/skills/${skill.name}`, content: skill.content });
    }
    for (const command of source.commands) {
      files.push({ path: `.gemini/commands/${command.name}`, content: command.content });
    }

    if (source.mcp) {
      files.push({ path: ".gemini/settings.json", content: toClaudeJson(source.mcp) });
    }

    return files;
  }
}
