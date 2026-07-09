export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function dedupeTranscriptLines(lines: string[]): string[] {
  return lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
}

export function trimTranscriptLines(
  lines: string[],
  options?: { maxLines?: number; maxChars?: number },
): string[] {
  let result = [...lines];

  if (options?.maxLines !== undefined && options.maxLines >= 0) {
    result = result.slice(-options.maxLines);
  }

  if (options?.maxChars !== undefined && options.maxChars >= 0) {
    while (result.length > 1 && result.join("\n").length > options.maxChars) {
      result = result.slice(1);
    }
  }

  return result;
}
