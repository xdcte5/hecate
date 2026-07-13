import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import {
  runBenchmark,
  simulateRunners,
  formatReportTable,
  type BenchMode,
  type BenchSpec,
  type BenchTask,
} from "@relay/orchestrator";

/** Built-in spec used when the user runs `hecate bench --simulate` with no file. */
const EXAMPLE_SPEC: BenchSpec = {
  tasks: [
    { id: "todo-api", goal: "build a REST todo API with express and jwt auth" },
    { id: "portfolio", goal: "build a react portfolio page with a contact form" },
    { id: "fix-parser", goal: "fix the off-by-one bug in the CSV parser and add a test" },
  ],
  costPer1kTokens: { default: 0.015 },
};

async function loadSpec(path: string): Promise<BenchSpec> {
  const raw = await readFile(path, "utf8");
  const parsed = path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error(`Bench spec ${path} must contain a non-empty "tasks" array`);
  }
  return parsed as BenchSpec;
}

export function registerBenchCommands(program: Command, getCwd: () => string): void {
  program
    .command("bench")
    .description("Benchmark single-agent baseline vs multi-agent Hecate and report savings")
    .argument("[spec]", "path to a bench spec (.yaml or .json)")
    .option("--simulate", "run without agents/tokens using deterministic stand-ins")
    .option("--baseline <harness>", "harness for the single-agent baseline")
    .option("--workspace <dir>", "seed dir copied to a fresh temp workspace per run (real mode)")
    .option("--out <file>", "write the full JSON report to this path")
    .action(
      async (
        specPath: string | undefined,
        options: { simulate?: boolean; baseline?: string; workspace?: string; out?: string },
      ) => {
        const cwd = getCwd();

        let spec: BenchSpec;
        if (specPath) {
          spec = await loadSpec(specPath);
        } else if (options.simulate) {
          spec = EXAMPLE_SPEC;
        } else {
          console.error("Provide a bench spec file, or use --simulate to try the built-in example.");
          process.exitCode = 1;
          return;
        }
        if (options.baseline) spec = { ...spec, baseline: options.baseline as BenchSpec["baseline"] };

        // Isolate each run in its own copy of the seed so file-change counts are clean.
        let workspaceFor: ((task: BenchTask, mode: BenchMode) => string) | undefined;
        if (!options.simulate && options.workspace) {
          const root = await mkdtemp(join(tmpdir(), "hecate-bench-"));
          const seeded = new Map<string, string>();
          for (const task of spec.tasks) {
            for (const mode of ["baseline", "hecate"] as BenchMode[]) {
              const dest = join(root, `${task.id}-${mode}`);
              await mkdir(dest, { recursive: true });
              await cp(options.workspace, dest, { recursive: true });
              seeded.set(`${task.id}:${mode}`, dest);
            }
          }
          workspaceFor = (task, mode) => seeded.get(`${task.id}:${mode}`)!;
          console.log(`Prepared ${seeded.size} isolated workspaces under ${root}`);
        }

        if (options.simulate) {
          console.log("Running in --simulate mode (no agents, illustrative numbers).\n");
        }

        const report = await runBenchmark({
          cwd,
          spec,
          runners: options.simulate ? simulateRunners() : undefined,
          snapshotFiles: !options.simulate,
          workspaceFor,
          onLine: (line) => console.log(line),
        });

        console.log(`\n${formatReportTable(report)}`);

        if (options.out) {
          await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
          console.log(`\nWrote JSON report to ${options.out}`);
        }
      },
    );
}
