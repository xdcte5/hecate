import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Adapted from ide-bridge src/store/file_store.ts (MIT License).
 * Writes content atomically via temp file + rename.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, { mode });
  await fs.rename(tmp, filePath);
}
