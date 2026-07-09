import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { HarnessIdSchema, type HarnessId, type HarnessCard } from "@relay/schema";
import { detectInstalledBinaries } from "@relay/adapters";
import { loadRegistry } from "@relay/registry";
import { DEFAULT_LOGIN_ARGS, readAuthState, recordAuth } from "../auth.js";
import { loadOrchestratorConfig } from "../orchestrator-config.js";

function parseHarness(value: string): HarnessId {
  const parsed = HarnessIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid harness: ${value}. Expected one of ${HarnessIdSchema.options.join(", ")}`);
  }
  return parsed.data;
}

async function firstInstalledBinary(card: HarnessCard): Promise<string | null> {
  const found = await detectInstalledBinaries(card.binaries);
  return found[0] ?? null;
}

/** Log into a single harness by running its native CLI login, inheriting the terminal. */
async function loginOne(
  cwd: string,
  card: HarnessCard,
  loginArgs: string[],
): Promise<"ok" | "not-installed" | "failed"> {
  const binary = await firstInstalledBinary(card);
  if (!binary) {
    console.log(`  ${card.id}: not installed (${card.binaries.join(", ")}) — skipping`);
    return "not-installed";
  }

  console.log(`\n▶ ${card.id}: launching \`${binary} ${loginArgs.join(" ")}\` …`);
  console.log("  (complete the login in your harness, then return here)");
  const result = spawnSync(binary, loginArgs, { cwd, stdio: "inherit" });

  const ok = result.status === 0 && !result.error;
  await recordAuth(cwd, card.id, ok);
  console.log(ok ? `  ✓ ${card.id} logged in` : `  ✗ ${card.id} login did not complete`);
  return ok ? "ok" : "failed";
}

export function registerLoginCommands(program: Command, getCwd: () => string): void {
  program
    .command("login")
    .description("Log into your harness subscriptions (runs each CLI's native login)")
    .argument("[harness]", "Harness to log into; omit to log into all")
    .option("--status", "Show which harnesses are authenticated")
    .option("--all", "Log into every configured harness")
    .action(async (harness: string | undefined, options: { status?: boolean; all?: boolean }) => {
      const cwd = getCwd();
      const registry = await loadRegistry(cwd);
      const config = await loadOrchestratorConfig(cwd);

      if (options.status) {
        const auth = await readAuthState(cwd);
        console.log("Harness login status:");
        for (const card of registry.harnesses) {
          const installed = (await firstInstalledBinary(card)) !== null;
          const record = auth.harnesses[card.id];
          const state = !installed
            ? "not installed"
            : record?.authenticated
              ? `authenticated${record.at ? ` (${record.at.slice(0, 10)})` : ""}`
              : "not logged in";
          const mark = record?.authenticated ? "✓" : installed ? "·" : "✗";
          console.log(`  ${mark} ${card.id.padEnd(12)} ${state}`);
        }
        console.log("\nRelay stores no credentials — each harness owns its own auth.");
        return;
      }

      const loginArgsFor = (id: HarnessId): string[] =>
        config.login?.[id] ?? DEFAULT_LOGIN_ARGS[id];

      const targets: HarnessCard[] = harness
        ? registry.harnesses.filter((c) => c.id === parseHarness(harness))
        : registry.harnesses;

      if (targets.length === 0) {
        console.error(`No such harness in registry: ${harness}`);
        process.exitCode = 1;
        return;
      }

      console.log(
        harness
          ? `Logging into ${harness} …`
          : `Logging into ${targets.length} harness(es). Relay runs each CLI's own login.`,
      );

      let ok = 0;
      let failed = 0;
      for (const card of targets) {
        const outcome = await loginOne(cwd, card, loginArgsFor(card.id));
        if (outcome === "ok") ok += 1;
        else if (outcome === "failed") failed += 1;
      }

      console.log(`\nDone: ${ok} logged in, ${failed} failed. Run \`relay login --status\` anytime.`);
      if (failed > 0) process.exitCode = 1;
    });
}
