import type { SteerQueue } from "@relay/orchestrator";
import { EditorBuffer, detectEditorHint, formatEditorHint, parseEditorLine } from "./editor.js";
import { formatSteerAck, resolveTuiInput, type TuiInputAction } from "./input.js";

export type TuiInputState = {
  resetEditor: () => void;
  processRawLine: (
    line: string,
    busy: boolean,
  ) =>
    | { phase: "continue"; statusHint?: string }
    | { phase: "submit"; action: TuiInputAction; displayLine: string; statusHint?: string };
};

export function createTuiInputState(): TuiInputState {
  let editorBuffer = new EditorBuffer();

  return {
    resetEditor() {
      editorBuffer = new EditorBuffer();
    },
    processRawLine(line: string, busy: boolean) {
      const hint = detectEditorHint(line);
      const statusHint = hint ? formatEditorHint(hint) : undefined;
      const parsed = parseEditorLine(line, editorBuffer);

      if (parsed.action === "continue") {
        editorBuffer = parsed.buffer;
        return { phase: "continue", statusHint };
      }

      editorBuffer = new EditorBuffer();
      const action = resolveTuiInput(parsed.text, { busy });
      return { phase: "submit", action, displayLine: parsed.text, statusHint };
    },
  };
}

export function queueSteerMessage(steerQueue: SteerQueue, message: string): string | null {
  return steerQueue.enqueue(message) ? formatSteerAck(message) : null;
}

export { formatSteerAck, resolveTuiInput, type TuiInputAction };
