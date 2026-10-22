import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_BINARY_SPECS,
  checkAgentBinaries,
  formatInstallReport,
  runInstall,
} from "./install.js";

function isolateEmptyPathEnv(): { tmpHome: string } {
  const tmpHome = mkdtempSync(join(os.tmpdir(), "relay-install-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.PATH = "/nonexistent-bin-dir";
  delete process.env.NVM_BIN;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.npm_config_prefix;
  return { tmpHome };
}

describe("relay install", () => {
  let tmpHome = "";
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let prevPath: string | undefined;
  let prevNvmBin: string | undefined;
  let prevNpmPrefix: string | undefined;
  let prevNpmConfigPrefix: string | undefined;

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = "";
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevNvmBin === undefined) delete process.env.NVM_BIN;
    else process.env.NVM_BIN = prevNvmBin;
    if (prevNpmPrefix === undefined) delete process.env.NPM_CONFIG_PREFIX;
    else process.env.NPM_CONFIG_PREFIX = prevNpmPrefix;
    if (prevNpmConfigPrefix === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = prevNpmConfigPrefix;
    vi.restoreAllMocks();
  });

  it("reports missing binaries with fix hints when PATH is empty", async () => {
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevPath = process.env.PATH;
    prevNvmBin = process.env.NVM_BIN;
    prevNpmPrefix = process.env.NPM_CONFIG_PREFIX;
    prevNpmConfigPrefix = process.env.npm_config_prefix;
    ({ tmpHome } = isolateEmptyPathEnv());

    const statuses = await checkAgentBinaries();
    expect(statuses.every((status) => !status.installed)).toBe(true);

    const report = formatInstallReport(statuses).join("\n");
    for (const spec of AGENT_BINARY_SPECS) {
      expect(report).toContain(spec.harness);
      expect(report).toContain(spec.hint);
    }
  });

  it("marks a binary found when it exists on a mocked PATH", async () => {
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevPath = process.env.PATH;
    prevNvmBin = process.env.NVM_BIN;
    prevNpmPrefix = process.env.NPM_CONFIG_PREFIX;
    prevNpmConfigPrefix = process.env.npm_config_prefix;
    ({ tmpHome } = isolateEmptyPathEnv());

    const binDir = join(tmpHome, "bin");
    mkdirSync(binDir, { recursive: true });
    const piPath = join(binDir, "pi");
    writeFileSync(piPath, "#!/bin/sh\n");
    chmodSync(piPath, 0o755);
    process.env.PATH = binDir;

    const statuses = await checkAgentBinaries();
    const pi = statuses.find((status) => status.harness === "Pi");
    expect(pi?.installed).toBe(true);
    expect(pi?.resolvedPath).toBe(piPath);
  });

  it("returns false from runInstall when binaries are missing", async () => {
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevPath = process.env.PATH;
    prevNvmBin = process.env.NVM_BIN;
    prevNpmPrefix = process.env.NPM_CONFIG_PREFIX;
    prevNpmConfigPrefix = process.env.npm_config_prefix;
    ({ tmpHome } = isolateEmptyPathEnv());

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message) => {
      logs.push(String(message));
    });

    const ok = await runInstall();
    expect(ok).toBe(false);
    expect(logs.join("\n")).toContain("fix:");
  });
});
