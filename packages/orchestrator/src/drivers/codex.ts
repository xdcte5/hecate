import type { HarnessId } from "@relay/schema";
import { parseGenericToolLine, StreamingCliDriver, type ParsedToolLine } from "./streaming-cli.js";

/** Codex `exec` driver with structured stdout events. */
export class CodexDriver extends StreamingCliDriver {
  readonly harness: HarnessId = "codex";

  parseToolLine(line: string): ParsedToolLine {
    const generic = parseGenericToolLine(line);
    if (generic) return generic;

    const trimmed = line.trim();
    const execMatch = trimmed.match(/^(?:exec(?:uting)?|command)\s*[:\s]+(.+)$/i);
    if (execMatch) {
      return { toolName: "bash", args: { command: execMatch[1]!.trim() } };
    }

    const codexTool = trimmed.match(/^⏺\s*(.+)$/);
    if (codexTool) {
      return { toolName: "tool", args: { detail: codexTool[1]!.trim() } };
    }

    return null;
  }
}
