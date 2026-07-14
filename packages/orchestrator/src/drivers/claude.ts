import type { HarnessId } from "@relay/schema";
import { parseGenericToolLine, StreamingCliDriver, type ParsedToolLine } from "./streaming-cli.js";

/** Claude Code `-p` driver with structured stdout events. */
export class ClaudeDriver extends StreamingCliDriver {
  readonly harness: HarnessId = "claude-code";

  parseToolLine(line: string): ParsedToolLine {
    const generic = parseGenericToolLine(line);
    if (generic) return generic;

    const trimmed = line.trim();
    const toolUse = trimmed.match(/^Tool(?:Use| use)?:?\s*(\w+)\s*(.*)$/i);
    if (toolUse) {
      const toolName = toolUse[1]!.toLowerCase();
      const rest = toolUse[2]?.trim();
      return {
        toolName,
        args: rest ? { detail: rest } : undefined,
      };
    }

    return null;
  }
}
