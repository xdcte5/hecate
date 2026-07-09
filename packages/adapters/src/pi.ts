import type { HarnessId } from "@relay/schema";
import { BaseAdapter, type BuildContext, type GeneratedFile } from "./adapter.js";
import { toClaudeJson } from "./mcp-transform.js";
import type { RelaySource } from "./source.js";

/**
 * Pi adapter (project scope).
 *
 * | Concern      | Output           |
 * | ------------ | ---------------- |
 * | Instructions | `AGENTS.md`      |
 * | Subagents    | `agents/<name>`  |
 * | Skills       | `skills/<name>`  |
 * | Commands     | `prompts/<name>` |
 * | MCP          | `mcp.json`       |
 *
 * Pi shares the project `AGENTS.md` standard with Codex, so both emit a
 * byte-identical file from shared instructions (see `agentsSessionFooter`).
 * Global scope (`~/.pi/`) is opt-in via `relay build --pi-global`, handled by
 * the build orchestrator — the adapter itself always emits project-relative
 * paths.
 */
export class PiAdapter extends BaseAdapter {
  readonly harness: HarnessId = "pi";

  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    files.push({
      path: "AGENTS.md",
      content: this.joinSections(this.instructionsFor(source), this.agentsSessionFooter(ctx)),
    });

    for (const agent of source.agents) {
      files.push({ path: `agents/${agent.name}`, content: agent.content });
    }
    for (const skill of source.skills) {
      files.push({ path: `skills/${skill.name}`, content: skill.content });
    }
    for (const command of source.commands) {
      files.push({ path: `prompts/${command.name}`, content: command.content });
    }

    if (source.mcp) {
      files.push({ path: "mcp.json", content: toClaudeJson(source.mcp) });
    }

    return files;
  }
}
