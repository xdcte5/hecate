import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toClaudeJson } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Antigravity (`agy`) adapter.
 *
 * | Concern      | Output                    |
 * | ------------ | ------------------------- |
 * | Instructions | `.agy/AGENTS.md`          |
 * | Subagents    | `.agy/agents/<name>`      |
 * | Skills       | `.agy/skills/<name>`      |
 * | Commands     | `.agy/commands/<name>`    |
 * | MCP          | `.agy/settings.json`      |
 *
 * Instructions are namespaced under `.agy/` to avoid colliding with the shared
 * root `AGENTS.md` that Codex/Pi emit. Adjust the path if Antigravity adopts a
 * different convention.
 */
export class AntigravityAdapter extends BaseAdapter {
  readonly harness: HarnessId = "antigravity";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    const injectHeader = ctx.handoffPointer
      ? `> **Active session:** read \`${ctx.handoffPointer}\` first for current context.`
      : null;

    files.push({
      path: ".agy/AGENTS.md",
      content: this.joinSections(injectHeader, this.instructionsFor(source)),
    });

    for (const agent of source.agents) {
      files.push({ path: `.agy/agents/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `.agy/skills/${skill.name}`, content: skill.content });
    }
    for (const command of source.commands) {
      files.push({ path: `.agy/commands/${command.name}`, content: command.content });
    }

    if (source.mcp) {
      files.push({ path: ".agy/settings.json", content: toClaudeJson(source.mcp) });
    }

    return files;
  }
}
