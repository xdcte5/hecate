import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * Return true if `binary` is an executable on PATH. Used by `relay init` to
 * enable only harnesses the user actually has installed.
 */
export async function isBinaryInstalled(binary: string): Promise<boolean> {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // not here; keep looking
    }
  }
  return false;
}

/** Filter a list of binary names down to those installed on PATH. */
export async function detectInstalledBinaries(binaries: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const binary of binaries) {
    if (await isBinaryInstalled(binary)) found.push(binary);
  }
  return found;
}
