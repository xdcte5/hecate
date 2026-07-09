import readline from "node:readline";
import { loadRelayConfig } from "@relay/registry";
import { getPromptStatus, processPrompt } from "@relay/orchestrator";
import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { scanLocalAgents, promptAgentSelection } from "./agent-picker.js";
import { renderFooter, type FooterState } from "./footer.js";
import {
  readLocalConfig,
  writeLocalConfig,
  formatLocalConfigSummary,
  type LocalConfig,
} from "./local-config.js";
import { discoverHarnessModels, formatModelChoices, promptModelSelection } from "./model-picker.js";
import { loadOrchestratorConfig } from "../orchestrator-config.js";
import {
  formatRelayBanner,
  formatTranscriptEntry,
  parseOrchestratorLine,
} from "./transcript.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

type RelayTuiOptions = {
  cwd: string;
};

type RuntimeState = {
  goal?: string;
  harness?: HarnessId;
  step?: number;
  totalSteps?: number;
};

export async function runRelayTui(options: RelayTuiOptions): Promise<void> {
  const { cwd } = options;
  let localConfig = await readLocalConfig(cwd);
  const orchestratorConfig = await loadOrchestratorConfig(cwd);
  const { registry } = await loadRelayConfig(cwd);

  const scan = await scanLocalAgents(registry);
  if (localConfig.enabledAgents.length === 0) {
    const installed = scan.filter((a) => a.installed);
    if (installed.length > 0) {
      process.stdout.write(
        `${ANSI.dim}First run — pick which local agents Relay can use.${ANSI.reset}\n`,
      );
      localConfig.enabledAgents = await promptAgentSelection(scan, []);
      await writeLocalConfig(cwd, localConfig);
    }
  }

  let runtime: RuntimeState = {};
  const session = await new SessionStore({ rootDir: cwd }).getActive();
  runtime.goal = session?.goal;

  const paintFooter = () => {
    const footer: FooterState = {
      cwd,
      goal: runtime.goal,
      harness: runtime.harness,
      model: resolveActiveModel(localConfig, runtime.harness),
      modelMode: localConfig.modelMode,
      step: runtime.step,
      totalSteps: runtime.totalSteps,
      width: process.stdout.columns,
    };
    process.stdout.write(`${renderFooter(footer)}\n`);
  };

  process.stdout.write(`\n${formatRelayBanner(runtime.goal)}\n\n`);
  paintFooter();
  process.stdout.write("\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: `${ANSI.dim}you${ANSI.reset} ${ANSI.bold}›${ANSI.reset} `,
  });

  let busy = false;
  let abortController: AbortController | null = null;
  let interruptCount = 0;
  let interruptTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (text: string) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const entry = parseOrchestratorLine(text);
    process.stdout.write(`${formatTranscriptEntry(entry)}\n`);
    updateRuntimeFromLine(text, runtime);
  };

  const say = (text: string) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} ${text}\n`);
  };

  const showStatus = async () => {
    const rows = await getPromptStatus(cwd);
    for (const row of rows) emit(row);
    paintFooter();
  };

  const showConfig = () => {
    for (const row of formatLocalConfigSummary(localConfig)) say(row);
  };

  const runAgentsPicker = async () => {
    rl.pause();
    localConfig.enabledAgents = await promptAgentSelection(scan, localConfig.enabledAgents);
    await writeLocalConfig(cwd, localConfig);
    say(`Enabled: ${localConfig.enabledAgents.join(", ") || "(none)"}`);
    rl.resume();
    rl.prompt();
  };

  const runModelsPicker = async () => {
    rl.pause();
    const enabled = localConfig.enabledAgents.length
      ? localConfig.enabledAgents
      : scan.filter((a) => a.installed).map((a) => a.id);

    const choices = [];
    for (const harness of enabled) {
      const agent = scan.find((a) => a.id === harness);
      const discovered = await discoverHarnessModels(harness, registry, agent?.installedBinary);
      choices.push({
        harness,
        models: discovered.models,
        selected: localConfig.modelOverrides[harness],
        limitation: discovered.limitation,
      });
    }

    for (const line of formatModelChoices(choices)) say(line);
    const overrides = await promptModelSelection(choices);
    localConfig.modelOverrides = { ...localConfig.modelOverrides, ...overrides };
    localConfig.modelMode = Object.keys(localConfig.modelOverrides).length > 0 ? "manual" : "auto";
    await writeLocalConfig(cwd, localConfig);
    say(`Model mode: ${localConfig.modelMode}`);
    rl.resume();
    rl.prompt();
  };

  const runConfigWizard = async () => {
    await runAgentsPicker();
    await runModelsPicker();
    showConfig();
  };

  const cleanup = () => {
    abortController?.abort();
    rl.close();
    process.stdout.write(ANSI.reset);
  };

  const resetBusy = () => {
    busy = false;
    abortController = null;
    rl.resume();
    paintFooter();
    process.stdout.write("\n");
    rl.prompt();
  };

  rl.on("SIGINT", () => {
    interruptCount += 1;
    if (interruptTimer) clearTimeout(interruptTimer);
    interruptTimer = setTimeout(() => {
      interruptCount = 0;
    }, 2000);

    if (busy && interruptCount === 1) {
      say(`${ANSI.yellow}Working… status · agents · models · Ctrl+C twice to cancel${ANSI.reset}`);
      rl.prompt();
      return;
    }

    if (busy && interruptCount >= 2) {
      say("Cancelling…");
      abortController?.abort();
      resetBusy();
      interruptCount = 0;
      return;
    }

    console.log("\n");
    cleanup();
    process.exit(0);
  });

  rl.on("line", (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit" || trimmed === "q") {
        cleanup();
        return;
      }

      if (trimmed === "status" || trimmed === "progress") {
        await showStatus();
        rl.prompt();
        return;
      }

      if (trimmed === "agents") {
        await runAgentsPicker();
        return;
      }

      if (trimmed === "models") {
        await runModelsPicker();
        return;
      }

      if (trimmed === "config") {
        await runConfigWizard();
        rl.prompt();
        return;
      }

      if (trimmed === "help" || trimmed === "?") {
        say("status · agents · models · config · quit — or type a goal");
        rl.prompt();
        return;
      }

      if (busy) {
        say(`${ANSI.yellow}Still working — status or Ctrl+C twice to cancel${ANSI.reset}`);
        rl.prompt();
        return;
      }

      busy = true;
      abortController = new AbortController();
      rl.pause();
      runtime = { goal: trimmed };

      try {
        const result = await processPrompt(cwd, trimmed, {
          signal: abortController.signal,
          enabledAgents:
            localConfig.enabledAgents.length > 0 ? localConfig.enabledAgents : undefined,
          // orchestrator.yaml models are the base; interactive picks win.
          modelOverrides: { ...orchestratorConfig.models, ...localConfig.modelOverrides },
          modelMode: localConfig.modelMode,
          maxConcurrency: orchestratorConfig.maxConcurrency,
          verify: orchestratorConfig.verify,
          routingOverrides: orchestratorConfig.routing,
          onLine: (row) => emit(row),
        });

        if (!result.ok && !abortController.signal.aborted) {
          say("Stopped — try again or rephrase your prompt.");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          emit(error instanceof Error ? error.message : String(error));
        }
      } finally {
        resetBusy();
      }
    })();
  });

  rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}

function resolveActiveModel(config: LocalConfig, harness?: HarnessId): string | undefined {
  if (!harness || config.modelMode === "auto") return undefined;
  return config.modelOverrides[harness];
}

function updateRuntimeFromLine(line: string, runtime: RuntimeState): void {
  const stepMatch = line.match(/▶ Step (\d+)\/(\d+)/);
  if (stepMatch) {
    runtime.step = Number.parseInt(stepMatch[1]!, 10);
    runtime.totalSteps = Number.parseInt(stepMatch[2]!, 10);
  }

  const agentMatch = line.match(/agent:\s*(\S+)/i);
  if (agentMatch) {
    const token = agentMatch[1]!.toLowerCase();
    if (token.includes("pi")) runtime.harness = "pi";
    else if (token.includes("codex")) runtime.harness = "codex";
    else if (token.includes("cursor")) runtime.harness = "cursor";
    else if (token.includes("claude")) runtime.harness = "claude-code";
  }

  const planMatch = line.match(/•\s*(Claude Code|Codex|Cursor|Pi)\b/);
  if (planMatch) {
    const label = planMatch[1]!;
    const map: Record<string, HarnessId> = {
      "Claude Code": "claude-code",
      Codex: "codex",
      Cursor: "cursor",
      Pi: "pi",
    };
    runtime.harness = map[label];
  }
}
