import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessEvent } from "@relay/schema";
import { processPrompt } from "../../../packages/orchestrator/src/process-prompt.js";

const fixtureRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

let tmp: string;
let previousMock: string | undefined;

beforeEach(() => {
  previousMock = process.env.RELAY_MOCK_DRIVER;
  process.env.RELAY_MOCK_DRIVER = "1";
});

afterEach(() => {
  if (previousMock === undefined) delete process.env.RELAY_MOCK_DRIVER;
  else process.env.RELAY_MOCK_DRIVER = previousMock;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

describe("E2E fusion: prompt → plan → step events (mock driver)", () => {
  it("runs NL prompt through plan and emits typed step events", async () => {
    tmp = mkdtempSync(join(os.tmpdir(), "relay-fusion-e2e-"));
    cpSync(fixtureRoot, tmp, { recursive: true, filter: (src) => !src.includes("/e2e/") });

    git(tmp, ["init", "--template="]);
    git(tmp, ["config", "user.email", "fusion@test.local"]);
    git(tmp, ["config", "user.name", "Fusion E2E"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "init"]);

    const events: HarnessEvent[] = [];
    const result = await processPrompt(tmp, "add a demo feature", {
      onEvent: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);

    const plan = events.find((event) => event.type === "plan");
    expect(plan).toBeDefined();
    if (plan?.type === "plan") {
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    }

    const stepStarts = events.filter((event) => event.type === "step_start");
    const stepEnds = events.filter((event) => event.type === "step_end");
    expect(stepStarts.length).toBeGreaterThanOrEqual(1);
    expect(stepEnds.length).toBeGreaterThanOrEqual(1);
    expect(stepEnds.some((event) => event.type === "step_end" && event.ok)).toBe(true);

    const toolEvents = events.filter(
      (event) => event.type === "tool_start" || event.type === "tool_end",
    );
    expect(toolEvents.length).toBeGreaterThanOrEqual(2);
  }, 20_000);
});
