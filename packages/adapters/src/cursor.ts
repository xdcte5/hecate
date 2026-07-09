import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toCursorJson } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Cursor adapter.
 *
 * | Concern      | Output                     |
 * | ------------ | -------------------------- |
 * | Instructions | `.cursor/rules/main.mdc`   |
 * | Subagents    | `.cursor/agents/<name>`    |
 * | Skills       | `.cursor/skills/<name>`    |
 * | MCP          | `.cursor/mcp.json`         |
 *
 * The main rule is an always-applied `.mdc` with YAML frontmatter. Session
 * inject rides as an `alwaysApply` note at the top of the rule body.
 */
export class CursorAdapter extends BaseAdapter {
  readonly harness: HarnessId = "cursor";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    const injectNote = ctx.handoffPointer
      ? `> Active session — read \`${ctx.handoffPointer}\` first for current context.`
      : null;

    const body = this.joinSections(injectNote, this.instructionsFor(source));
    const frontmatter = [
      "---",
      "description: Relay project rules",
      "globs:",
      "alwaysApply: true",
      "---",
      "",
    ].join("\n");

    files.push({ path: ".cursor/rules/main.mdc", content: `${frontmatter}${body}` });

    for (const agent of source.agents) {
      files.push({ path: `.cursor/agents/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `.cursor/skills/${skill.name}`, content: skill.content });
    }

    if (source.mcp) {
      files.push({ path: ".cursor/mcp.json", content: toCursorJson(source.mcp) });
    }

    return files;
  }
}
