import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectInstalledBinaries, resolveBinaryPath } from "./detect.js";

describe("resolveBinaryPath", () => {
  let tempHome: string;
  let previousHome: string | undefined;
  let previousPath: string | undefined;

  let previousNvmBin: string | undefined;
  let previousNpmPrefix: string | undefined;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "relay-detect-"));
    previousHome = process.env.HOME;
    previousPath = process.env.PATH;
    previousNvmBin = process.env.NVM_BIN;
    previousNpmPrefix = process.env.NPM_CONFIG_PREFIX;
    process.env.HOME = tempHome;
    process.env.PATH = "/usr/bin:/bin";
    delete process.env.NVM_BIN;
    delete process.env.NPM_CONFIG_PREFIX;
  });

  afterEach(async () => {
    process.env.HOME = previousHome;
    process.env.PATH = previousPath;
    if (previousNvmBin === undefined) delete process.env.NVM_BIN;
    else process.env.NVM_BIN = previousNvmBin;
    if (previousNpmPrefix === undefined) delete process.env.NPM_CONFIG_PREFIX;
    else process.env.NPM_CONFIG_PREFIX = previousNpmPrefix;
    await rm(tempHome, { recursive: true, force: true });
  });

  async function installBinary(relativeDir: string, name: string): Promise<string> {
    const dir = join(tempHome, relativeDir);
    await mkdir(dir, { recursive: true });
    const full = join(dir, name);
    await writeFile(full, "#!/bin/sh\n", "utf8");
    await chmod(full, 0o755);
    return full;
  }

  it("finds binaries on PATH", async () => {
    const pathDir = await mkdtemp(join(tmpdir(), "relay-path-"));
    const full = join(pathDir, "pi");
    await writeFile(full, "#!/bin/sh\n", "utf8");
    await chmod(full, 0o755);
    process.env.PATH = pathDir;

    expect(await resolveBinaryPath("pi")).toBe(full);
    await rm(pathDir, { recursive: true, force: true });
  });

  it("finds pi under nvm version bins when PATH omits nvm", async () => {
    const full = await installBinary(".nvm/versions/node/v22.23.1/bin", "pi");
    expect(await resolveBinaryPath("pi")).toBe(full);
  });

  it("finds binaries under npm global prefix", async () => {
    const prefix = join(tempHome, ".npm-global");
    await installBinary(".npm-global/bin", "pi");
    process.env.NPM_CONFIG_PREFIX = prefix;

    expect(await resolveBinaryPath("pi")).toBe(join(prefix, "bin", "pi"));
  });

  it("finds binaries under ~/.local/bin", async () => {
    const full = await installBinary(".local/bin", "claude");
    expect(await resolveBinaryPath("claude")).toBe(full);
  });

  it("returns null when binary is missing everywhere", async () => {
    expect(await resolveBinaryPath("missing-agent-cli")).toBeNull();
  });
});

describe("detectInstalledBinaries", () => {
  it("returns absolute paths for installed binaries", async () => {
    const pathDir = await mkdtemp(join(tmpdir(), "relay-detect-list-"));
    const full = join(pathDir, "pi");
    await writeFile(full, "#!/bin/sh\n", "utf8");
    await chmod(full, 0o755);
    process.env.PATH = pathDir;

    expect(await detectInstalledBinaries(["pi", "missing"])).toEqual([full]);
    await rm(pathDir, { recursive: true, force: true });
  });
});
