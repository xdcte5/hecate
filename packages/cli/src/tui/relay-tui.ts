import readline from "node:readline";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRelayConfig } from "@relay/registry";
import { getPromptStatus, processPrompt } from "@relay/orchestrator";
import type { HarnessId } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { scanLocalAgents, AgentPickerModal } from "./agent-picker.js";
import { renderFooter, type FooterState } from "./footer.js";
import {
  readLocalConfig,
  writeLocalConfig,
  formatLocalConfigSummary,
  type LocalConfig,
} from "./local-config.js";
import {
  discoverHarnessModels,
  formatModelChoices,
  ModelPickerModal,
  type ModelChoice,
} from "./model-picker.js";
import type { ModalController } from "./modal.js";
import { loadOrchestratorConfig } from "../orchestrator-config.js";
import { formatHecateBanner } from "./transcript.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Clean input caret — no "you" label, matches the banner colour. */
const PROMPT = `${ANSI.magenta}${ANSI.bold}❯${ANSI.reset} `;

type RelayTuiOptions = {
  cwd: string;
  /** Keep session folders on quit instead of deleting them (ephemeral by default). */
  preserve?: boolean;
};

type RuntimeState = {
  goal?: string;
  harness?: HarnessId;
  step?: number;
  totalSteps?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActiveModal = { modal: ModalController<any>; onDone: (result: any) => Promise<void> | void };

export async function runRelayTui(options: RelayTuiOptions): Promise<void> {
  const { cwd, preserve = false } = options;
  let localConfig = await readLocalConfig(cwd);
  const orchestratorConfig = await loadOrchestratorConfig(cwd);
  const { registry } = await loadRelayConfig(cwd);
  const scan = await scanLocalAgents(registry);

  const sessionStore = new SessionStore({ rootDir: cwd });
  // Session folders created this run; purged on quit unless --preserve.
  const sessionIds = new Set<string>();

  let runtime: RuntimeState = {};
  const existing = await sessionStore.getActive();
  if (existing) {
    runtime.goal = existing.goal;
    sessionIds.add(existing.sessionId);
  }

  let busy = false;
  let abortController: AbortController | null = null;
  let interruptCount = 0;
  let interruptTimer: ReturnType<typeof setTimeout> | null = null;
  let activeModal: ActiveModal | null = null;
  let quitting = false;
  let rl: readline.Interface;
  let resolveDone: () => void = () => {};

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

  // Verbose orchestration trace goes to a log file, not the chat window.
  const logPath = join(cwd, ".relay", "hecate.log");
  const logLine = (text: string) => {
    void appendFile(logPath, `${new Date().toISOString()} ${text}\n`).catch(() => {});
  };

  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;
  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
  const startSpinner = () => {
    stopSpinner();
    spinnerTimer = setInterval(() => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      const frame = SPINNER_FRAMES[spinnerFrame++ % SPINNER_FRAMES.length];
      process.stdout.write(`${ANSI.dim}${frame} working…${ANSI.reset}`);
    }, 90);
  };

  // onLine — trace only: log it and keep the footer/harness state current.
  const emit = (text: string) => {
    logLine(text);
    updateRuntimeFromLine(text, runtime);
  };

  // onResponse — the actual answer or error, printed cleanly to the chat window.
  const respond = (text: string, kind: "answer" | "error") => {
    stopSpinner();
    const color = kind === "error" ? ANSI.red : "";
    for (const row of text.split("\n")) {
      process.stdout.write(`${color}${row}${color ? ANSI.reset : ""}\n`);
    }
    if (busy) startSpinner();
  };

  const say = (text: string) => {
    stopSpinner();
    process.stdout.write(`${ANSI.dim}hecate${ANSI.reset} ${ANSI.bold}›${ANSI.reset} ${text}\n`);
  };

  /** Prompt for the next line — unless a modal owns the input or work is running. */
  const promptUser = () => {
    if (activeModal || busy) return;
    rl.setPrompt(PROMPT);
    rl.prompt();
  };

  const enterModal = (modal: ActiveModal["modal"], onDone: ActiveModal["onDone"]) => {
    activeModal = { modal, onDone };
    modal.render();
  };

  const showStatus = async () => {
    const rows = await getPromptStatus(cwd);
    for (const row of rows) say(row);
    paintFooter();
  };

  const showConfig = () => {
    for (const row of formatLocalConfigSummary(localConfig)) say(row);
  };

  const openAgentsPicker = () => {
    const modal = new AgentPickerModal(scan, localConfig.enabledAgents, (t) => process.stdout.write(t));
    if (!modal.hasInstalledAgents) {
      say("No agent CLIs found on PATH. Install pi, claude, codex, or cursor-agent.");
      promptUser();
      return;
    }
    enterModal(modal, async (enabled: HarnessId[]) => {
      localConfig.enabledAgents = enabled;
      await writeLocalConfig(cwd, localConfig);
      say(`Enabled: ${enabled.join(", ") || "(none)"}`);
    });
  };

  const openModelsPicker = async (after?: () => void) => {
    const enabled = localConfig.enabledAgents.length
      ? localConfig.enabledAgents
      : scan.filter((a) => a.installed).map((a) => a.id);

    const choices: ModelChoice[] = [];
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

    const modal = new ModelPickerModal(choices, (t) => process.stdout.write(t));
    if (!modal.hasSelectableModels) {
      say("No overridable models — routing stays ability-based auto.");
      after?.();
      promptUser();
      return;
    }
    enterModal(modal, async (overrides: Partial<Record<HarnessId, string>>) => {
      localConfig.modelOverrides = { ...localConfig.modelOverrides, ...overrides };
      localConfig.modelMode = Object.keys(localConfig.modelOverrides).length > 0 ? "manual" : "auto";
      await writeLocalConfig(cwd, localConfig);
      say(`Model mode: ${localConfig.modelMode}`);
      after?.();
    });
  };

  const openConfigWizard = () => {
    const modal = new AgentPickerModal(scan, localConfig.enabledAgents, (t) => process.stdout.write(t));
    if (!modal.hasInstalledAgents) {
      say("No agent CLIs found on PATH. Install pi, claude, codex, or cursor-agent.");
      promptUser();
      return;
    }
    enterModal(modal, async (enabled: HarnessId[]) => {
      localConfig.enabledAgents = enabled;
      await writeLocalConfig(cwd, localConfig);
      say(`Enabled: ${enabled.join(", ") || "(none)"}`);
      await openModelsPicker(() => showConfig());
    });
  };

  const runPrompt = async (trimmed: string) => {
    busy = true;
    abortController = new AbortController();
    runtime = { goal: trimmed };
    startSpinner();

    try {
      await processPrompt(cwd, trimmed, {
        signal: abortController.signal,
        enabledAgents:
          localConfig.enabledAgents.length > 0 ? localConfig.enabledAgents : undefined,
        // orchestrator.yaml models are the base; interactive picks win.
        modelOverrides: { ...orchestratorConfig.models, ...localConfig.modelOverrides },
        modelMode: localConfig.modelMode,
        maxConcurrency: orchestratorConfig.maxConcurrency,
        verify: orchestratorConfig.verify,
        routingOverrides: orchestratorConfig.routing,
        subSessions: orchestratorConfig.subSessions,
        onLine: (row) => emit(row),
        onResponse: (text, kind) => respond(text, kind),
      });
    } catch (error) {
      if (!abortController?.signal.aborted) {
        respond(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      const active = await sessionStore.getActive();
      if (active) sessionIds.add(active.sessionId);
      busy = false;
      abortController = null;
      stopSpinner();
      paintFooter();
      promptUser();
    }
  };

  const onLine = (line: string) => {
    void (async () => {
      if (activeModal) {
        const step = activeModal.modal.handleLine(line);
        if (step.done) {
          const done = activeModal.onDone;
          activeModal = null;
          await done(step.result);
          promptUser();
        }
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        promptUser();
        return;
      }

      if (trimmed === "status" || trimmed === "progress") {
        await showStatus();
        promptUser();
        return;
      }

      if (trimmed === "agents") {
        openAgentsPicker();
        return;
      }

      if (trimmed === "models") {
        await openModelsPicker();
        return;
      }

      if (trimmed === "config") {
        openConfigWizard();
        return;
      }

      if (trimmed === "help" || trimmed === "?") {
        say("status · agents · models · config — or type a goal. Ctrl+C twice to quit.");
        promptUser();
        return;
      }

      if (busy) {
        say(`${ANSI.yellow}Still working — status, or Ctrl+C twice to cancel${ANSI.reset}`);
        return;
      }

      await runPrompt(trimmed);
    })();
  };

  const shutdown = () => {
    void (async () => {
      quitting = true;
      abortController?.abort();
      if (!preserve && sessionIds.size > 0) {
        for (const id of sessionIds) {
          try {
            await sessionStore.purge(id);
          } catch {
            // best-effort cleanup — nothing actionable if a folder is already gone
          }
        }
      }
      process.stdout.write(`${ANSI.reset}\n`);
      rl.close();
      process.exit(0);
    })();
  };

  const handleSigint = () => {
    interruptCount += 1;
    if (interruptTimer) clearTimeout(interruptTimer);
    interruptTimer = setTimeout(() => {
      interruptCount = 0;
    }, 2000);

    if (busy) {
      if (interruptCount === 1) {
        say(`${ANSI.yellow}Working… Ctrl+C twice to cancel${ANSI.reset}`);
        return;
      }
      say("Cancelling…");
      abortController?.abort();
      interruptCount = 0;
      return;
    }

    // Idle or inside a picker — Hecate only quits on a double Ctrl+C.
    if (interruptCount === 1) {
      say(`${ANSI.yellow}Press Ctrl+C again to quit Hecate${ANSI.reset}`);
      promptUser();
      return;
    }
    shutdown();
  };

  // Ctrl+D / stray EOF must not end the session — re-arm the reader instead.
  const onClose = () => {
    if (quitting || !process.stdin.isTTY) {
      resolveDone();
      return;
    }
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    bindHandlers();
    promptUser();
  };

  function bindHandlers() {
    rl.setPrompt(PROMPT);
    rl.on("line", onLine);
    rl.on("SIGINT", handleSigint);
    rl.on("close", onClose);
  }

  process.stdout.write(`\n${formatHecateBanner(runtime.goal)}\n\n`);
  paintFooter();
  process.stdout.write("\n");

  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  bindHandlers();

  const firstRun = localConfig.enabledAgents.length === 0;
  if (firstRun) {
    const modal = new AgentPickerModal(scan, [], (t) => process.stdout.write(t));
    if (modal.hasInstalledAgents) {
      process.stdout.write(
        `${ANSI.dim}First run — pick which local agents Hecate can use.${ANSI.reset}\n`,
      );
      enterModal(modal, async (enabled: HarnessId[]) => {
        localConfig.enabledAgents = enabled;
        await writeLocalConfig(cwd, localConfig);
        say(`Enabled: ${enabled.join(", ") || "(none)"}`);
      });
    } else {
      promptUser();
    }
  } else {
    promptUser();
  }

  await new Promise<void>((resolve) => {
    resolveDone = resolve;
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
