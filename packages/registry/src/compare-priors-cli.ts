import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  RoutingOutcomeSchema,
  RoutingPriorsSchema,
  type HarnessId,
  type RoutingOutcome,
} from "@relay/schema";
import { getBenchmarkPrior } from "./routing-priors.js";
import { computePriorDrift, formatPriorDriftReport } from "./routing-stats-reader.js";

const AGENT_TO_HARNESS: Record<string, HarnessId> = {
  claude: "claude-code",
  codex: "codex",
};

const TASK_TO_TYPE: Record<string, string> = {
  A: "implement",
  B: "fix",
  C: "implement",
};

type MiniBenchRow = {
  agent: string;
  task_id: string;
  success?: boolean;
  cost_usd?: number | null;
  harnesses?: HarnessId[];
};

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function miniBenchRowsToOutcomes(rows: MiniBenchRow[]): RoutingOutcome[] {
  const outcomes: RoutingOutcome[] = [];

  for (const row of rows) {
    const taskType = TASK_TO_TYPE[row.task_id];
    if (!taskType) continue;

    if (row.agent === "relay" && !row.harnesses?.length) {
      continue;
    }

    const mapped = AGENT_TO_HARNESS[row.agent];
    if (!mapped && row.agent !== "relay") {
      continue;
    }

    const harnesses: HarnessId[] =
      row.agent === "relay" && row.harnesses?.length
        ? row.harnesses
        : [mapped!];

    for (const harness of harnesses) {
      outcomes.push(
        RoutingOutcomeSchema.parse({
          ts: new Date().toISOString(),
          sessionId: "mini-bench",
          stepId: `${row.agent}-${row.task_id}`,
          taskType,
          task: `mini-bench task ${row.task_id}`,
          harness,
          ok: Boolean(row.success),
          verifyOk: Boolean(row.success),
          costUsd: row.cost_usd ?? undefined,
        }),
      );
    }
  }

  return outcomes;
}

export function loadOutcomesForPriorDrift(options: {
  benchResultsPath?: string;
  routingStatsPath?: string;
}): RoutingOutcome[] {
  const stats: RoutingOutcome[] = [];

  if (options.routingStatsPath) {
    for (const row of readJsonl(options.routingStatsPath)) {
      stats.push(RoutingOutcomeSchema.parse(row));
    }
  }

  if (options.benchResultsPath) {
    stats.push(...miniBenchRowsToOutcomes(readJsonl(options.benchResultsPath) as MiniBenchRow[]));
  }

  return stats;
}

export function printPriorDriftReportFromFiles(options: {
  benchResultsPath?: string;
  routingStatsPath?: string;
  priorsPath: string;
}): string {
  const priors = existsSync(options.priorsPath)
    ? RoutingPriorsSchema.parse(parseYaml(readFileSync(options.priorsPath, "utf8")))
    : RoutingPriorsSchema.parse({ version: "0", task_types: {} });

  const stats = loadOutcomesForPriorDrift(options);
  const rows = computePriorDrift(stats, priors, (taskType, harness) =>
    getBenchmarkPrior(priors, taskType, harness),
  );

  const lines = [
    formatPriorDriftReport(rows),
    "",
    "Sources:",
    `  priors: ${existsSync(options.priorsPath) ? options.priorsPath : "(missing)"}`,
    `  routing-stats: ${options.routingStatsPath && existsSync(options.routingStatsPath) ? options.routingStatsPath : "(missing)"}`,
    `  mini-bench: ${options.benchResultsPath && existsSync(options.benchResultsPath) ? options.benchResultsPath : "(missing)"}`,
  ];

  return lines.join("\n");
}

function main() {
  const benchResultsPath = process.argv[2];
  const routingStatsPath = process.argv[3];
  const priorsPath = process.argv[4] ?? "relay/routing-priors.yaml";

  console.log(
    printPriorDriftReportFromFiles({
      benchResultsPath,
      routingStatsPath,
      priorsPath,
    }),
  );
}

if (process.argv[1]?.endsWith("compare-priors-cli.js")) {
  main();
}
