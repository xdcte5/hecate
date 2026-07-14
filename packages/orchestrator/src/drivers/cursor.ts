import type { HarnessId } from "@relay/schema";
import { parseGenericToolLine, StreamingCliDriver, type ParsedToolLine } from "./streaming-cli.js";

/** Cursor agent `-p` driver with structured stdout events. */
export class CursorDriver extends StreamingCliDriver {
  readonly harness: HarnessId = "cursor";

  parseToolLine(line: string): ParsedToolLine {
    const generic = parseGenericToolLine(line);
    if (generic) return generic;

    const trimmed = line.trim();
    const cursorAction = trimmed.match(/^(?:Using tool|Tool)\s+(\w+)\s*(?:[:\(]\s*(.+?)\)?)?$/i);
    if (cursorAction) {
      const toolName = cursorAction[1]!.toLowerCase();
      const detail = cursorAction[2]?.trim();
      return {
        toolName,
        args: detail ? { detail } : undefined,
      };
    }

    return null;
  }
}
