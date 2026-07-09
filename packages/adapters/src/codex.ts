import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toCodexToml } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Codex adapter.
 *
 * | Concern      | Output                  |
 * | ------------ | ----------------------- |
 * | Instructions | `AGENTS.md`             |
 * | Subagents    | `.codex/skills/<name>`  |
 * | Skills       | `.codex/skills/<name>`  |
 * | MCP          | `.codex/config.toml`    |
 *
 * Codex has no separate subagent surface, so `agents/` and `skills/` both land
 * under `.codex/skills/`. Session inject is appended as an AGENTS.md footer.
 */
export class CodexAdapter extends BaseAdapter {
  readonly harness: HarnessId = "codex";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    files.push({
      path: "AGENTS.md",
      content: this.joinSections(this.instructionsFor(source), this.agentsSessionFooter(ctx)),
    });

    for (const agent of source.agents) {
      files.push({ path: `.codex/skills/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `.codex/skills/${skill.name}`, content: skill.content });
    }

    if (source.mcp) {
      files.push({ path: ".codex/config.toml", content: toCodexToml(source.mcp) });
    }

    return files;
  }
}
