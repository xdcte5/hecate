export type EditorHint =
  | { kind: "file"; token: string }
  | { kind: "shell"; token: string };

export type EditorSubmit =
  | { action: "continue"; buffer: EditorBuffer }
  | { action: "submit"; text: string };

/** Minimal multiline editor buffer (Pi-style trailing backslash continuation). */
export class EditorBuffer {
  private lines: string[] = [];

  constructor(initial = "") {
    if (initial) this.lines = initial.split("\n");
  }

  get text(): string {
    return this.lines.join("\n");
  }

  get lineCount(): number {
    return this.lines.length;
  }

  isMultiline(): boolean {
    return this.lines.length > 1;
  }

  appendLine(line: string): EditorBuffer {
    return new EditorBuffer([...this.lines, line].join("\n"));
  }
}

/** Detect @file or !cmd hint token at end of input (Pi editor affordances). */
export function detectEditorHint(text: string, cursorIndex = text.length): EditorHint | null {
  const before = text.slice(0, cursorIndex);
  const atMatch = /(^|\s)@([\w./\-]*)$/.exec(before);
  if (atMatch) {
    return { kind: "file", token: atMatch[2] ?? "" };
  }

  const bangIdx = before.lastIndexOf("!");
  if (bangIdx >= 0) {
    const tokenMatch = /^(\w[\w./-]*)/.exec(before.slice(bangIdx + 1));
    if (tokenMatch) {
      return { kind: "shell", token: tokenMatch[1] ?? "" };
    }
    return { kind: "shell", token: "" };
  }

  return null;
}

export function formatEditorHint(hint: EditorHint): string {
  if (hint.kind === "file") {
    return hint.token ? `@${hint.token} — attach file reference` : "@ — type a file path";
  }
  return hint.token ? `!${hint.token} — run shell command` : "! — type a shell command";
}

/** Parse one editor line; trailing \\ continues multiline input. */
export function parseEditorLine(line: string, buffer: EditorBuffer = new EditorBuffer()): EditorSubmit {
  if (line.endsWith("\\")) {
    const chunk = line.slice(0, -1);
    const next = chunk ? buffer.appendLine(chunk) : buffer;
    return { action: "continue", buffer: next };
  }

  const merged = buffer.lineCount > 0 ? `${buffer.text}\n${line}` : line;
  return { action: "submit", text: merged.trim() };
}

export function editorPreview(text: string): string {
  if (!text.includes("\n")) return text;
  const lines = text.split("\n");
  return `${lines[0]} … (+${lines.length - 1} line${lines.length === 2 ? "" : "s"})`;
}
