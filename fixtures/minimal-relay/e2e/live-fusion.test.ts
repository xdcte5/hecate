import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectInstalledBinaries,
  detectPiAuthProviders,
  discoverPiListedModels,
  resolveBinaryPath,
} from "../../../packages/adapters/src/index.js";
import { loadRelayConfig } from "../../../packages/registry/src/index.js";
import type { HarnessId } from "../../../packages/schema/src/index.js";
import { readEvents, SessionStore } from "../../../packages/session/src/index.js";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterRunnableHarnesses } from "../../../packages/orchestrator/src/harness-eligibility.js";
import { processPrompt } from "../../../packages/orchestrator/src/process-prompt.js";

const liveEnabled =
  process.env.RELAY_LIVE_E2E === "1" || process.env.RELAY_LIVE_E2E === "true";

const fixtureRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const GOAL = "Create hello.sh printing hello";

let previousMock: string | undefined;

async function detectRunnableHarnesses(cwd: string): Promise<HarnessId[]> {
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);
  const installed: HarnessId[] = [];

  for (const card of registry.harnesses) {
    const found = await detectInstalledBinaries(card.binaries);
    if (found.length > 0) installed.push(card.id);
  }

  const piInstalled = installed.includes("pi");
  const piBinary = piInstalled ? await resolveBinaryPath("pi") : null;
  const [piAuthProviders, piListedModels] = piInstalled
    ? await Promise.all([
        detectPiAuthProviders(),
        piBinary ? discoverPiListedModels(piBinary) : Promise.resolve([]),
      ])
    : [undefined, []];

  return filterRunnableHarnesses(sessionPolicy.failover, {
    installed,
    piAuthProviders: piAuthProviders ? new Set([...piAuthProviders].map(String)) : undefined,
    piListedModels,
  });
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function setupWorkspace(): string {
  const dir = mkdtempSync(join(os.tmpdir(), "relay-live-fusion-e2e-"));
  cpSync(fixtureRoot, dir, { recursive: true, filter: (src) => !src.includes("/e2e/") });
  git(dir, ["init", "--template="]);
  git(dir, ["config", "user.email", "live-fusion@test.local"]);
  git(dir, ["config", "user.name", "Live Fusion E2E"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

const tmp = liveEnabled ? setupWorkspace() : undefined;
const selectedHarness = liveEnabled && tmp ? (await detectRunnableHarnesses(tmp))[0] : undefined;

if (liveEnabled && !selectedHarness) {
  console.warn(
    "No runnable harness CLI found (claude-code, codex, cursor, pi). Skipping live fusion E2E.",
  );
} else if (selectedHarness) {
  console.log(`Live fusion E2E using harness: ${selectedHarness}`);
}

describe.skipIf(!liveEnabled)("E2E live fusion: real harness CLI", () => {
  beforeEach(() => {
    previousMock = process.env.RELAY_MOCK_DRIVER;
    delete process.env.RELAY_MOCK_DRIVER;
  });

  afterEach(() => {
    if (previousMock === undefined) delete process.env.RELAY_MOCK_DRIVER;
    else process.env.RELAY_MOCK_DRIVER = previousMock;
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it.skipIf(!selectedHarness)(
    "creates hello.sh and records harness_complete + routing_outcome",
    async () => {
      const harness = selectedHarness!;

      const result = await processPrompt(tmp!, GOAL, {
        enabledAgents: [harness],
        harnessOverride: harness,
        onLine: (line) => console.log(`[${harness}] ${line}`),
      });

      expect(result.ok).toBe(true);

      const helloPath = join(tmp!, "hello.sh");
      await access(helloPath, constants.F_OK);

      const output = execFileSync("bash", [helloPath], {
        cwd: tmp!,
        encoding: "utf8",
      });
      expect(output).toMatch(/hello/i);

      const store = new SessionStore({ rootDir: tmp! });
      const session = await store.getActive();
      expect(session).not.toBeNull();

      const events = await readEvents(tmp!, session!.sessionId);
      const eventNames = events.map((event) => event.event);
      expect(eventNames).toContain("harness_complete");
      expect(eventNames).toContain("routing_outcome");

      const harnessComplete = events.find((event) => event.event === "harness_complete");
      expect(harnessComplete).toMatchObject({
        event: "harness_complete",
        harness,
        ok: true,
      });

      const routingOutcome = events.find((event) => event.event === "routing_outcome");
      expect(routingOutcome).toMatchObject({
        event: "routing_outcome",
        harness,
        ok: true,
      });

      const helloContent = await readFile(helloPath, "utf8");
      expect(helloContent.length).toBeGreaterThan(0);
    },
    300_000,
  );
});
