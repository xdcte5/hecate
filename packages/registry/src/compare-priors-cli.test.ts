import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { miniBenchRowsToOutcomes, printPriorDriftReportFromFiles } from "./compare-priors-cli.js";

async function writePriorsFixture() {
  const dir = join(tmpdir(), `relay-priors-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "relay"), { recursive: true });
  await writeFile(
    join(dir, "relay", "routing-priors.yaml"),
    `version: "1"\ntask_types:\n  implement:\n    claude-code: 0.68\n`,
    "utf8",
  );
  return dir;
}

describe("compare-priors-cli", () => {
  it("maps mini-bench rows to routing outcomes", () => {
    const outcomes = miniBenchRowsToOutcomes([
      {
        agent: "claude",
        task_id: "A",
        success: true,
        cost_usd: 0.25,
      },
      {
        agent: "relay",
        task_id: "B",
        success: true,
        cost_usd: 0.08,
        harnesses: ["claude-code"],
      },
    ]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({
      taskType: "implement",
      harness: "claude-code",
      ok: true,
      costUsd: 0.25,
    });
    expect(outcomes[1]).toMatchObject({
      taskType: "fix",
      harness: "claude-code",
      ok: true,
      costUsd: 0.08,
    });
  });

  it("prints drift report from priors and bench rows", async () => {
    const cwd = await writePriorsFixture();
    const report = printPriorDriftReportFromFiles({
      benchResultsPath: undefined,
      routingStatsPath: undefined,
      priorsPath: join(cwd, "relay", "routing-priors.yaml"),
    });

    expect(report).toContain("Prior drift report");
    expect(report).toContain("Sources:");
  });
});
