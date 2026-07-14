import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import type { HarnessRunResult } from "./drivers/types.js";
import { resolveFilesTouched } from "./outcome.js";

export async function recordStepOutcome(
  cwd: string,
  sessionId: string,
  harness: HarnessId,
  result: HarnessRunResult,
  treeBefore = "",
): Promise<void> {
  const store = new SessionStore({ rootDir: cwd });
  const files = await resolveFilesTouched(cwd, treeBefore, result.filesTouched);
  await store.recordProgress(sessionId, {
    summary: `${harness}: ${result.summary}`,
    filesTouched: files.slice(0, 50),
  });
}
