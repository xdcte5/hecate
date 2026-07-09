import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import type { HarnessRunResult } from "./drivers/types.js";
import { listChangedFiles } from "./verify.js";

export async function recordStepOutcome(
  cwd: string,
  sessionId: string,
  harness: HarnessId,
  result: HarnessRunResult,
): Promise<void> {
  const store = new SessionStore({ rootDir: cwd });
  const files = result.filesTouched ?? (await listChangedFiles(cwd));
  await store.recordProgress(sessionId, {
    summary: `${harness}: ${result.summary}`,
    filesTouched: files.slice(0, 50),
  });
}
