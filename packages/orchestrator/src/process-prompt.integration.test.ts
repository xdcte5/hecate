import { cpSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "@relay/schema";
import * as factory from "./drivers/factory.js";
import { processPrompt } from "./process-prompt.js";

const detectInstalledBinaries = vi.hoisted(() => vi.fn());
const detectPiAuthProviders = vi.hoisted(() => vi.fn());
const discoverPiListedModels = vi.hoisted(() => vi.fn());
const resolveBinaryPath = vi.hoisted(() => vi.fn());

vi.mock("@relay/adapters", () => ({
  detectInstalledBinaries,
  detectPiAuthProviders,
  discoverPiListedModels,
  resolveBinaryPath,
  buildProject: vi.fn().mockResolvedValue(undefined),
}));

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures/minimal-relay",
);

const piListedModels = [
  {
    provider: "azure-openai-responses",
    modelId: "gpt-4",
    spec: "azure-openai-responses/gpt-4",
  },
];

async function seedWorkspace(cwd: string): Promise<void> {
  await mkdir(join(cwd, "relay"), { recursive: true });
  cpSync(join(fixtureRoot, "relay"), join(cwd, "relay"), { recursive: true });

  writeFileSync(
    join(cwd, "relay", "session-policy.yaml"),
    `routing: []
failover:
  - pi
  - claude-code
  - codex
governance:
  requireGitSnapshotOnHandoff: true
  maxHandoffTokens: 8000
  maxTranscriptLines: 200
`,
    "utf8",
  );

  execFileSync("git", ["init", "--template="], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "harbor-exec@test.local"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Harbor Exec Test"], { cwd, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "pipe" });
}

describe("process-prompt integration (harbor-exec path)", () => {
  let createDriverSpy: ReturnType<typeof vi.spyOn>;
  let previousMockEnv: string | undefined;

  beforeEach(() => {
    previousMockEnv = process.env.RELAY_MOCK_DRIVER;
    process.env.RELAY_MOCK_DRIVER = "1";
    createDriverSpy = vi.spyOn(factory, "createDriver");

    detectInstalledBinaries.mockReset();
    detectInstalledBinaries.mockImplementation(async (binaries: string[]) => {
      const name = binaries[0];
      if (name === "pi") return ["/usr/local/bin/pi"];
      if (name === "claude") return ["relay-mock"];
      if (name === "codex") return ["relay-mock"];
      return [];
    });

    resolveBinaryPath.mockReset();
    resolveBinaryPath.mockResolvedValue("/usr/local/bin/pi");

    detectPiAuthProviders.mockReset();
    detectPiAuthProviders.mockResolvedValue(new Set(["openai-codex"]));

    discoverPiListedModels.mockReset();
    discoverPiListedModels.mockResolvedValue(piListedModels);
  });

  afterEach(() => {
    createDriverSpy.mockRestore();
    if (previousMockEnv === undefined) delete process.env.RELAY_MOCK_DRIVER;
    else process.env.RELAY_MOCK_DRIVER = previousMockEnv;
  });

  it("skips Pi when piAuthProviders exclude Pi models (harbor-exec enabledAgents)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-harbor-exec-no-pi-"));
    try {
      await seedWorkspace(cwd);
      const lines: string[] = [];

      const result = await processPrompt(cwd, "Create hello.sh printing hello", {
        enabledAgents: ["pi", "claude-code", "codex"] as HarnessId[],
        onLine: (line) => lines.push(line),
      });

      expect(result.ok).toBe(true);

      const spawnedHarnesses = createDriverSpy.mock.calls.map(([harness]: [HarnessId, string]) => harness);
      expect(spawnedHarnesses).not.toContain("pi");
      expect(spawnedHarnesses).toContain("claude-code");

      const joined = lines.join("\n");
      expect(joined).not.toMatch(/agent:.*Pi RPC/i);
      expect(joined).toMatch(/Skipped non-runnable harnesses:.*Pi/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
