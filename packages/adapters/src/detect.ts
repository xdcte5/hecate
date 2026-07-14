import { access, constants, readdir } from "node:fs/promises";
import { delimiter, join } from "node:path";

function homeDir(): string | undefined {
  return process.env.HOME ?? process.env.USERPROFILE;
}

/** Collect executable search directories: PATH, then common install locations. */
async function executableSearchDirs(): Promise<string[]> {
  const dirs: string[] = [];
  const seen = new Set<string>();

  const add = (dir: string | undefined) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    dirs.push(dir);
  };

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    add(dir);
  }

  add(process.env.NVM_BIN);

  const npmPrefix = process.env.NPM_CONFIG_PREFIX ?? process.env.npm_config_prefix;
  if (npmPrefix) add(join(npmPrefix, "bin"));

  const home = homeDir();
  if (home) {
    add(join(home, ".local", "bin"));
    add(join(home, ".pi", "bin"));

    const nvmRoot = join(home, ".nvm", "versions", "node");
    try {
      const versions = await readdir(nvmRoot, { withFileTypes: true });
      for (const entry of versions) {
        if (entry.isDirectory()) {
          add(join(nvmRoot, entry.name, "bin"));
        }
      }
    } catch {
      // nvm not installed or unreadable
    }
  }

  return dirs;
}

/**
 * Resolve an executable name to an absolute path, checking PATH and common
 * install locations (e.g. nvm node version bins when the active PATH omits them).
 */
export async function resolveBinaryPath(binary: string): Promise<string | null> {
  for (const dir of await executableSearchDirs()) {
    const full = join(dir, binary);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {
      // not here; keep looking
    }
  }
  return null;
}

/**
 * Return true if `binary` is an executable on PATH or a common install location.
 */
export async function isBinaryInstalled(binary: string): Promise<boolean> {
  return (await resolveBinaryPath(binary)) !== null;
}

/** Filter a list of binary names down to installed executables (absolute paths). */
export async function detectInstalledBinaries(binaries: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const binary of binaries) {
    const path = await resolveBinaryPath(binary);
    if (path) found.push(path);
  }
  return found;
}
