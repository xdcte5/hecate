import fs from "node:fs/promises";
import type { SessionEvent } from "./events.js";
import { eventsPath } from "./paths.js";

export async function readEvents(rootDir: string, sessionId: string): Promise<SessionEvent[]> {
  const raw = await fs.readFile(eventsPath(rootDir, sessionId), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as SessionEvent;
      } catch {
        throw new Error(`events.jsonl line ${index + 1}: invalid JSON`);
      }
    });
}
