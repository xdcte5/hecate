import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  applySignalAdjustments,
  getBenchmarkPrior,
  loadRoutingPriors,
} from "./routing-priors.js";

const priorsYaml = `
version: "1"
updated: "2026-07-14"
task_types:
  test:
    codex: 0.85
    codex/o4-mini: 0.92
    pi: 0.35
  implement:
    pi: 0.88
    cursor: 0.55
signal_adjustments:
  - signal: frontend
    adjustment: 0.08
    target: cursor
  - signal: test
    adjustment: 0.1
    target: codex/o4-mini
`;

async function writeFixture(content: string) {
  const dir = join(tmpdir(), `relay-priors-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "relay"), { recursive: true });
  await writeFile(join(dir, "relay", "routing-priors.yaml"), content, "utf8");
  return dir;
}

describe("loadRoutingPriors", () => {
  it("parses fixture yaml", async () => {
    const cwd = await writeFixture(priorsYaml);
    const priors = await loadRoutingPriors(cwd);

    expect(priors.version).toBe("1");
    expect(priors.task_types.test?.codex).toBe(0.85);
    expect(priors.signal_adjustments).toHaveLength(2);
  });

  it("returns empty priors when file is missing", async () => {
    const dir = join(tmpdir(), `relay-priors-missing-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const priors = await loadRoutingPriors(dir);

    expect(priors.version).toBe("0");
    expect(priors.task_types).toEqual({});
  });
});

describe("getBenchmarkPrior", () => {
  it("returns model-specific prior when available", async () => {
    const cwd = await writeFixture(priorsYaml);
    const priors = await loadRoutingPriors(cwd);

    expect(getBenchmarkPrior(priors, "test", "codex", "o4-mini")).toBe(0.92);
  });

  it("falls back to harness prior then default", async () => {
    const cwd = await writeFixture(priorsYaml);
    const priors = await loadRoutingPriors(cwd);

    expect(getBenchmarkPrior(priors, "test", "codex", "o3")).toBe(0.85);
    expect(getBenchmarkPrior(priors, "unknown", "pi")).toBe(0.5);
  });
});

describe("applySignalAdjustments", () => {
  it("adds boosts for matching signals and targets", async () => {
    const cwd = await writeFixture(priorsYaml);
    const priors = await loadRoutingPriors(cwd);
    const signals = new Set(["frontend"]);

    expect(applySignalAdjustments(priors, signals, "cursor")).toBe(0.08);
    expect(applySignalAdjustments(priors, signals, "codex")).toBe(0);
  });

  it("supports harness/model targets", async () => {
    const cwd = await writeFixture(priorsYaml);
    const priors = await loadRoutingPriors(cwd);
    const signals = new Set(["test"]);

    expect(applySignalAdjustments(priors, signals, "codex", "o4-mini")).toBe(0.1);
  });
});
