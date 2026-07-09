import fs from "node:fs/promises";
import type { RhpV1 } from "@relay/schema";
import { RhpV1Schema } from "@relay/schema";
import {
  eventsPath,
  handoffMdPath,
  handoffPath,
  sessionPath,
} from "./paths.js";

export async function validateSession(
  rootDir: string,
  sessionId: string,
): Promise<{ valid: boolean; errors: string[]; session?: RhpV1 }> {
  const errors: string[] = [];
  let session: RhpV1 | undefined;

  try {
    const raw = await fs.readFile(sessionPath(rootDir, sessionId), "utf8");
    const parsed = RhpV1Schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      errors.push(`session.json: invalid schema (${parsed.error.message})`);
    } else {
      session = parsed.data;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      errors.push("session.json: file not found");
    } else {
      errors.push(`session.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (session && session.handoffSeq > 0) {
    for (const [label, filePath] of [
      ["handoff.json", handoffPath(rootDir, sessionId)],
      ["HANDOFF.md", handoffMdPath(rootDir, sessionId)],
    ] as const) {
      try {
        await fs.access(filePath);
      } catch {
        errors.push(`${label}: file not found (handoffSeq=${session.handoffSeq})`);
      }
    }
  }

  try {
    const eventsRaw = await fs.readFile(eventsPath(rootDir, sessionId), "utf8");
    const lines = eventsRaw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      errors.push("events.jsonl: file is empty");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      errors.push("events.jsonl: file not found");
    } else {
      errors.push(`events.jsonl: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(session ? { session } : {}),
  };
}
