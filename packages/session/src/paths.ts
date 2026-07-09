import path from "node:path";

export function sessionsRoot(rootDir: string): string {
  return path.join(rootDir, ".relay", "sessions");
}

export function sessionDir(rootDir: string, sessionId: string): string {
  return path.join(sessionsRoot(rootDir), sessionId);
}

export function sessionPath(rootDir: string, sessionId: string): string {
  return path.join(sessionDir(rootDir, sessionId), "session.json");
}

export function eventsPath(rootDir: string, sessionId: string): string {
  return path.join(sessionDir(rootDir, sessionId), "events.jsonl");
}

export function handoffPath(rootDir: string, sessionId: string): string {
  return path.join(sessionDir(rootDir, sessionId), "handoff.json");
}

export function handoffMdPath(rootDir: string, sessionId: string): string {
  return path.join(sessionDir(rootDir, sessionId), "HANDOFF.md");
}

export function activeSessionPath(rootDir: string): string {
  return path.join(sessionsRoot(rootDir), "active");
}
