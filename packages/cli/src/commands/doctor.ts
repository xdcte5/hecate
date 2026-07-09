import { Command } from "commander";
import { evaluateBrownfieldKpis, SessionStore, validateSession } from "@relay/session";
import { detectDrift, readRelayLock } from "@relay/adapters";

/**
 * Check manifest-owned generated files against relay.lock. Returns true when
 * clean (or nothing to check yet), false when drift was found.
 */
async function checkBuildDrift(cwd: string): Promise<boolean> {
  const lock = await readRelayLock(cwd);
  if (!lock) {
    console.log("No relay.lock found. Run `relay build --all` first.");
    return true;
  }

  const drift = await detectDrift(cwd, lock);
  if (drift.length === 0) {
    console.log(`PASS: ${lock.adapters.length} harness(es), no generated-file drift`);
    return true;
  }

  console.error(`FAIL: ${drift.length} generated file(s) drifted from relay.lock`);
  for (const finding of drift) {
    console.error(`  [${finding.harness}] ${finding.kind}: ${finding.path}`);
  }
  console.error("Re-run `relay build` to regenerate, or edit relay/ instead of the output.");
  return false;
}

function isActiveSessionFlag(value: string | true | undefined): value is true | "" {
  return value === true || value === "";
}

async function resolveSessionId(
  cwd: string,
  sessionOption: string | true | undefined,
): Promise<string | null> {
  if (sessionOption === undefined) return null;

  if (isActiveSessionFlag(sessionOption)) {
    const store = new SessionStore({ rootDir: cwd });
    const active = await store.getActive();
    return active?.sessionId ?? null;
  }

  return sessionOption;
}

export function registerDoctorCommands(program: Command, getCwd: () => string): void {
  program
    .command("doctor")
    .description("Diagnose relay setup")
    .option("--session [id]", "Validate session integrity (active session if no id)")
    .option("--kpi", "Run Brownfield KPI checks on active session")
    .option("--build", "Check generated files against relay.lock (default)")
    .action(async (options: { session?: string | true; kpi?: boolean; build?: boolean }) => {
      const cwd = getCwd();

      // Default check (no flags) is build/drift; explicit --build too.
      if (options.build || (options.session === undefined && !options.kpi)) {
        const clean = await checkBuildDrift(cwd);
        if (!clean) process.exitCode = 1;
        if (!options.session && !options.kpi) return;
      }

      if (options.kpi) {
        const store = new SessionStore({ rootDir: cwd });
        const active = await store.getActive();
        if (!active) {
          console.error("FAIL: No active session for KPI evaluation");
          process.exitCode = 1;
          return;
        }

        const report = await evaluateBrownfieldKpis(cwd, active.sessionId);
        console.log(`Brownfield KPIs — session ${active.sessionId}`);
        console.log("");

        for (const result of report.results) {
          const mark = result.passed ? "PASS" : result.automatable ? "FAIL" : "SKIP";
          console.log(`[Tier ${result.tier}] ${mark}  ${result.name}`);
          console.log(`         ${result.detail}`);
        }

        console.log("");
        console.log(
          `Automatable: ${report.automatablePassed}/${report.automatableTotal} | Tier 1: ${report.tier1Passed}/${report.tier1Total} | Tier 2: ${report.tier2Passed}/${report.tier2Total}`,
        );

        if (report.tier1Passed < report.tier1Total || report.tier2Passed < report.tier2Total) {
          process.exitCode = 1;
        }
        return;
      }

      const sessionId = await resolveSessionId(cwd, options.session);
      if (!sessionId) {
        console.error("FAIL: No active session");
        process.exitCode = 1;
        return;
      }

      const result = await validateSession(cwd, sessionId);

      if (result.valid) {
        console.log(`PASS: Session ${sessionId} is valid`);
        if (result.session) {
          console.log(`  Goal: ${result.session.goal}`);
          console.log(`  Status: ${result.session.status}`);
          console.log(`  Handoff seq: ${result.session.handoffSeq}`);
        }
      } else {
        console.error(`FAIL: Session ${sessionId} is invalid`);
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
        process.exitCode = 1;
      }
    });
}
