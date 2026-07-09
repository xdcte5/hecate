import fs from "node:fs/promises";
import { eventsPath, sessionDir } from "./paths.js";

export type SessionEvent = Record<string, unknown>;

export async function appendEvent(
  rootDir: string,
  sessionId: string,
  event: SessionEvent,
): Promise<void> {
  const line = `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`;
  await fs.mkdir(sessionDir(rootDir, sessionId), { recursive: true, mode: 0o700 });
  await fs.appendFile(eventsPath(rootDir, sessionId), line, { mode: 0o600 });
}
