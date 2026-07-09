import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessId } from "@relay/schema";
import { appendEvent } from "./events.js";
import { sessionDir } from "./paths.js";
import { trimTranscriptLines } from "./transcript-trimmer.js";

const DEFAULT_HARNESSES: HarnessId[] = ["claude-code", "codex", "cursor"];
const DEFAULT_MAX_LINES = 200;

export type ImportTranscriptsOptions = {
  harnesses?: HarnessId[];
  maxLines?: number;
  maxChars?: number;
};

export type ImportedTranscript = {
  harness: HarnessId;
  sourcePaths: string[];
  lineCount: number;
  destPath: string;
};

export type ImportTranscriptsResult = {
  imported: ImportedTranscript[];
  skipped: HarnessId[];
};

function claudeProjectSlug(rootDir: string): string {
  return `-${path.resolve(rootDir).split(path.sep).filter(Boolean).join("-")}`;
}

function cursorProjectSlug(rootDir: string): string {
  return path.resolve(rootDir).split(path.sep).filter(Boolean).join("-");
}

function transcriptDestPath(rootDir: string, sessionId: string, harness: HarnessId): string {
  return path.join(sessionDir(rootDir, sessionId), "transcripts", `${harness}.jsonl`);
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

async function readLinesFromSources(sourcePaths: string[]): Promise<string[]> {
  const files = await Promise.all(
    sourcePaths.map(async (sourcePath) => ({
      sourcePath,
      mtimeMs: (await fs.stat(sourcePath)).mtimeMs,
      lines: await readJsonlLines(sourcePath),
    })),
  );

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const lines: string[] = [];
  for (const file of files) {
    lines.push(...file.lines);
  }
  return lines;
}

async function discoverClaudeSources(rootDir: string): Promise<string[]> {
  const projectDir = path.join(os.homedir(), ".claude", "projects", claudeProjectSlug(rootDir));
  return collectJsonlFiles(projectDir);
}

async function discoverCodexSources(): Promise<string[]> {
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  return collectJsonlFiles(sessionsDir);
}

async function discoverCursorSources(rootDir: string): Promise<string[]> {
  const candidates = [
    path.join(rootDir, ".cursor", "agent-transcripts"),
    path.join(
      os.homedir(),
      ".cursor",
      "projects",
      cursorProjectSlug(rootDir),
      "agent-transcripts",
    ),
  ];

  const sourcePaths: string[] = [];
  for (const candidate of candidates) {
    sourcePaths.push(...(await collectJsonlFiles(candidate)));
  }

  return [...new Set(sourcePaths)];
}

async function discoverSources(
  harness: HarnessId,
  rootDir: string,
): Promise<string[]> {
  switch (harness) {
    case "claude-code":
      return discoverClaudeSources(rootDir);
    case "codex":
      return discoverCodexSources();
    case "cursor":
      return discoverCursorSources(rootDir);
    default:
      return [];
  }
}

export async function importTranscripts(
  rootDir: string,
  sessionId: string,
  options?: ImportTranscriptsOptions,
): Promise<ImportTranscriptsResult> {
  const harnesses = options?.harnesses ?? DEFAULT_HARNESSES;
  const trimOptions = {
    maxLines: options?.maxLines ?? DEFAULT_MAX_LINES,
    ...(options?.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
  };

  const imported: ImportedTranscript[] = [];
  const skipped: HarnessId[] = [];

  for (const harness of harnesses) {
    const sourcePaths = await discoverSources(harness, rootDir);
    if (sourcePaths.length === 0) {
      skipped.push(harness);
      continue;
    }

    const lines = trimTranscriptLines(await readLinesFromSources(sourcePaths), trimOptions);
    if (lines.length === 0) {
      skipped.push(harness);
      continue;
    }

    const destPath = transcriptDestPath(rootDir, sessionId, harness);
    const content = `${lines.join("\n")}\n`;
    await fs.mkdir(path.dirname(destPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(destPath, content, { mode: 0o600 });

    imported.push({
      harness,
      sourcePaths,
      lineCount: lines.length,
      destPath,
    });
  }

  if (imported.length > 0) {
    await appendEvent(rootDir, sessionId, {
      event: "transcripts_imported",
      harnesses: imported.map((entry) => entry.harness),
      sources: Object.fromEntries(
        imported.map((entry) => [entry.harness, entry.sourcePaths]),
      ),
      lineCounts: Object.fromEntries(
        imported.map((entry) => [entry.harness, entry.lineCount]),
      ),
    });
  }

  return { imported, skipped };
}
