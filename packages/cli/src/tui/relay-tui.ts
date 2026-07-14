import readline from "node:readline";
import { loadRelayConfig } from "@relay/registry";
import { syncEnabledAgentsWithInstalled } from "@relay/orchestrator";
import { getPromptStatus, processPrompt, createSteerQueue } from "@relay/orchestrator";
import type { HarnessEvent, HarnessId, ToolEndEvent } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { scanLocalAgents, promptAgentSelection } from "./agent-picker.js";
import { detectGitBranch, renderFooter, type FooterState } from "./footer.js";
import {
  readLocalConfig,
  writeLocalConfig,
  formatLocalConfigSummary,
  type LocalConfig,
} from "./local-config.js";
import { discoverHarnessModels, formatModelChoices, promptModelSelection } from "./model-picker.js";
import { createTuiInputState, queueSteerMessage } from "./tui-handlers.js";
import {
  formatHarnessOverrideAck,
  formatModelOverrideAck,
} from "./input.js";
import { autoScrollOffset, computeLayoutRegions, renderLayout } from "./layout.js";
import { AltScreen } from "./screen.js";
import {
  createTranscriptContext,
  findLatestToggleableToolKey,
  formatTranscriptEntry,
  parseOrchestratorLine,
  renderHarnessEvent,
  renderToolEndLines,
  toggleTranscriptToolExpand,
  type TranscriptRenderContext,
} from "./transcript.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

const INPUT_PROMPT = `${ANSI.dim}you${ANSI.reset} ${ANSI.bold}›${ANSI.reset} `;

type RelayTuiOptions = {
  cwd: string;
};

type RuntimeState = {
  goal?: string;
  harness?: HarnessId;
  step?: number;
  totalSteps?: number;
  contextPct?: number;
};

/**
 * TUI library choice: `@earendil-works/pi-tui@0.80.6` requires Node >=22.19.0,
 * which excludes Node 20 and older Node 22. Relay uses a custom ANSI alt-screen
 * shell in screen.ts / layout.ts until pi-tui engine range widens.
 */

export async function runRelayTui(options: RelayTuiOptions): Promise<void> {
  const { cwd } = options;
  let localConfig = await readLocalConfig(cwd);
  const { registry, sessionPolicy } = await loadRelayConfig(cwd);

  let scan = await scanLocalAgents(registry);
  const syncedEnabled = syncEnabledAgentsWithInstalled(
    localConfig.enabledAgents,
    scan.filter((a) => a.installed).map((a) => a.id),
    sessionPolicy.failover,
  );
  if (JSON.stringify(syncedEnabled) !== JSON.stringify(localConfig.enabledAgents)) {
    localConfig.enabledAgents = syncedEnabled;
    await writeLocalConfig(cwd, localConfig);
  }

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

  const transcriptLines: string[] = [];
  let transcriptContext: TranscriptRenderContext = createTranscriptContext();
  type ToolBlockSpan = { key: string; start: number; end: number; event: ToolEndEvent };
  const toolBlockSpans: ToolBlockSpan[] = [];
  let scrollOffset = 0;
  let stickToBottom = true;
  let statusLine: string | undefined;
  const gitBranch = detectGitBranch(cwd);

  const screen = new AltScreen({
    onResize: () => {
      repaint();
    },
  });

  let rl: readline.Interface;

  const buildFooterLine = (): string => {
    const footer: FooterState = {
      cwd,
      goal: runtime.goal,
      harness: runtime.harness,
      model: resolveActiveModel(localConfig, runtime.harness),
      modelMode: localConfig.modelMode,
      step: runtime.step,
      totalSteps: runtime.totalSteps,
      contextPct: runtime.contextPct,
      gitBranch,
      width: screen.size.cols,
    };
    return renderFooter(footer);
  };

  const repaint = () => {
    const { cols, rows } = screen.size;
    const regions = computeLayoutRegions(rows);
    scrollOffset = autoScrollOffset(
      transcriptLines.length,
      regions.transcriptRows,
      scrollOffset,
      stickToBottom,
    );

    const frame = renderLayout({
      goal: runtime.goal,
      transcriptLines,
      footerLine: buildFooterLine(),
      inputPrompt: INPUT_PROMPT,
      statusLine,
      scrollOffset,
      width: cols,
      height: rows,
    });

    rl.pause();
    screen.paint(frame);
    screen.setCursorVisible(true);
    rl.resume();
    rl.prompt(true);
  };

  screen.enter();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: INPUT_PROMPT,
  });

  readline.emitKeypressEvents(process.stdin, rl);
  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.ctrl && key.name === "o") {
      toggleFocusedToolBlock();
      return;
    }
    if (key.name === "o" && !key.ctrl && !busy && rl.line.length === 0) {
      toggleFocusedToolBlock();
    }
  });

  repaint();

  let busy = false;
  let abortController: AbortController | null = null;
  let interruptCount = 0;
  let interruptTimer: ReturnType<typeof setTimeout> | null = null;
  const steerQueue = createSteerQueue();
  const inputState = createTuiInputState();

  const appendTranscript = (lines: string[]) => {
    if (lines.length === 0) return;
    transcriptLines.push(...lines);
    stickToBottom = true;
    repaint();
  };

  const emitLine = (text: string) => {
    const entry = parseOrchestratorLine(text);
    appendTranscript([formatTranscriptEntry(entry)]);
    updateRuntimeFromLine(text, runtime);
    repaint();
  };

  const emitEvent = (event: HarnessEvent) => {
    const startIdx = transcriptLines.length;
    const rendered = renderHarnessEvent(event, transcriptContext);
    transcriptContext = rendered.context;
    if (rendered.lines.length > 0) {
      appendTranscript(rendered.lines);
    }
    if (event.type === "tool_end") {
      toolBlockSpans.push({
        key: event.toolCallId ?? event.toolName,
        start: startIdx,
        end: transcriptLines.length,
        event,
      });
    }
    updateRuntimeFromEvent(event, runtime);
    repaint();
  };

  const toggleFocusedToolBlock = () => {
    const toolKey = findLatestToggleableToolKey(transcriptContext);
    if (!toolKey) {
      statusLine = `${ANSI.dim}No tool block to expand — Ctrl+O after a tool finishes${ANSI.reset}`;
      repaint();
      return;
    }

    let spanIndex = -1;
    for (let i = toolBlockSpans.length - 1; i >= 0; i--) {
      if (toolBlockSpans[i]!.key === toolKey) {
        spanIndex = i;
        break;
      }
    }
    const span = spanIndex >= 0 ? toolBlockSpans[spanIndex] : undefined;
    if (!span) {
      statusLine = `${ANSI.dim}No tool block to expand${ANSI.reset}`;
      repaint();
      return;
    }

    transcriptContext = toggleTranscriptToolExpand(transcriptContext, toolKey);
    const newLines = renderToolEndLines(span.event, transcriptContext);
    const oldCount = span.end - span.start;
    transcriptLines.splice(span.start, oldCount, ...newLines);
    span.end = span.start + newLines.length;

    const delta = newLines.length - oldCount;
    for (let i = spanIndex + 1; i < toolBlockSpans.length; i++) {
      toolBlockSpans[i]!.start += delta;
      toolBlockSpans[i]!.end += delta;
    }

    statusLine = undefined;
    stickToBottom = true;
    repaint();
  };

  const say = (text: string) => {
    appendTranscript([
      `${ANSI.dim}relay${ANSI.reset} ${ANSI.bold}›${ANSI.reset} ${text}`,
    ]);
  };

  const showStatus = async () => {
    const rows = await getPromptStatus(cwd);
    for (const row of rows) emitLine(row);
  };

  const showConfig = () => {
    for (const row of formatLocalConfigSummary(localConfig)) say(row);
  };

  const runAgentsPicker = async () => {
    screen.exit();
    localConfig.enabledAgents = await promptAgentSelection(scan, localConfig.enabledAgents);
    await writeLocalConfig(cwd, localConfig);
    screen.enter();
    say(`Enabled: ${localConfig.enabledAgents.join(", ") || "(none)"}`);
    rl.prompt();
  };

  const runModelsPicker = async () => {
    screen.exit();
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

    for (const line of formatModelChoices(choices)) {
      process.stdout.write(`${line}\n`);
    }
    const overrides = await promptModelSelection(choices);
    localConfig.modelOverrides = { ...localConfig.modelOverrides, ...overrides };
    localConfig.modelMode = Object.keys(localConfig.modelOverrides).length > 0 ? "manual" : "auto";
    await writeLocalConfig(cwd, localConfig);
    screen.enter();
    say(`Model mode: ${localConfig.modelMode}`);
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
    screen.exit();
    process.stdout.write(ANSI.reset);
  };

  const resetBusy = () => {
    busy = false;
    abortController = null;
    statusLine = undefined;
    rl.resume();
    repaint();
  };

  rl.on("SIGINT", () => {
    interruptCount += 1;
    if (interruptTimer) clearTimeout(interruptTimer);
    interruptTimer = setTimeout(() => {
      interruptCount = 0;
    }, 2000);

    if (busy && interruptCount === 1) {
      statusLine = `${ANSI.yellow}Working… /status · /steer · /harness · /model · Ctrl+C twice to cancel${ANSI.reset}`;
      repaint();
      return;
    }

    if (busy && interruptCount >= 2) {
      say("Cancelling…");
      abortController?.abort();
      resetBusy();
      interruptCount = 0;
      return;
    }

    cleanup();
    process.stdout.write("\n");
    process.exit(0);
  });

  rl.on("line", (line) => {
    void (async () => {
      const parsed = inputState.processRawLine(line, busy);
      if (parsed.phase === "continue") {
        statusLine = parsed.statusHint;
        repaint();
        return;
      }

      statusLine = parsed.statusHint;
      const trimmed = parsed.displayLine.trim();
      if (!trimmed) {
        repaint();
        return;
      }

      appendTranscript([`${INPUT_PROMPT}${parsed.displayLine}`]);

      switch (parsed.action.type) {
        case "noop":
          repaint();
          return;
        case "quit":
          cleanup();
          return;
        case "status":
          await showStatus();
          rl.prompt();
          return;
        case "agents":
          await runAgentsPicker();
          return;
        case "models":
          await runModelsPicker();
          return;
        case "config":
          await runConfigWizard();
          rl.prompt();
          return;
        case "help":
          say("status · /status · agents · /agents · /harness · /model · /steer · models · config · quit — or type a goal");
          rl.prompt();
          return;
        case "busy-block":
          say(parsed.action.message);
          rl.prompt();
          return;
        case "harness": {
          localConfig.harnessOverride = parsed.action.harness;
          await writeLocalConfig(cwd, localConfig);
          say(formatHarnessOverrideAck(parsed.action.harness, busy));
          rl.prompt();
          return;
        }
        case "model": {
          localConfig.nextModelOverride = parsed.action.model;
          localConfig.modelMode = "manual";
          await writeLocalConfig(cwd, localConfig);
          say(formatModelOverrideAck(parsed.action.model, busy));
          rl.prompt();
          return;
        }
        case "hint":
          say(parsed.action.message);
          rl.prompt();
          return;
        case "steer": {
          const ack = queueSteerMessage(steerQueue, parsed.action.message);
          if (ack) say(ack);
          else say("Steer message was empty.");
          rl.prompt();
          return;
        }
        case "run":
          break;
      }

      if (busy) {
        say(`${ANSI.yellow}Still working — /steer, /status, or Ctrl+C twice to cancel${ANSI.reset}`);
        rl.prompt();
        return;
      }

      busy = true;
      abortController = new AbortController();
      rl.pause();
      runtime = { ...runtime, goal: trimmed };

      const harnessOverride = localConfig.harnessOverride;
      const nextModelOverride = localConfig.nextModelOverride;
      if (harnessOverride || nextModelOverride) {
        localConfig.harnessOverride = undefined;
        localConfig.nextModelOverride = undefined;
        await writeLocalConfig(cwd, localConfig);
      }

      try {
        const result = await processPrompt(cwd, trimmed, {
          signal: abortController.signal,
          steerQueue,
          enabledAgents:
            localConfig.enabledAgents.length > 0 ? localConfig.enabledAgents : undefined,
          modelOverrides: localConfig.modelOverrides,
          modelMode: localConfig.modelMode,
          harnessOverride,
          nextModelOverride,
          onLine: (row) => emitLine(row),
          onEvent: (event) => emitEvent(event),
        });

        if (!result.ok && !abortController.signal.aborted) {
          say("Stopped — try again or rephrase your prompt.");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          emitLine(error instanceof Error ? error.message : String(error));
        }
      } finally {
        steerQueue.clear();
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
    runtime.harness = parseHarnessToken(agentMatch[1]!);
  }

  const planMatch = line.match(/•\s*(Claude Code|Codex|Cursor|Pi)\b/);
  if (planMatch) {
    runtime.harness = harnessFromLabel(planMatch[1]!);
  }
}

function updateRuntimeFromEvent(event: HarnessEvent, runtime: RuntimeState): void {
  switch (event.type) {
    case "step_start":
      runtime.harness = event.harness;
      if (event.stepIndex !== undefined) runtime.step = event.stepIndex + 1;
      if (event.totalSteps !== undefined) runtime.totalSteps = event.totalSteps;
      break;
    case "step_end":
      runtime.harness = event.harness;
      break;
    case "agent_start":
      if (event.harness) runtime.harness = event.harness;
      break;
    case "plan":
      if (event.steps.length > 0) {
        runtime.totalSteps = event.steps.length;
        runtime.harness = event.steps[0]!.harness;
      }
      break;
    default:
      break;
  }
}

function parseHarnessToken(token: string): HarnessId | undefined {
  const lower = token.toLowerCase();
  if (lower.includes("pi")) return "pi";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("claude")) return "claude-code";
  return undefined;
}

function harnessFromLabel(label: string): HarnessId {
  const map: Record<string, HarnessId> = {
    "Claude Code": "claude-code",
    Codex: "codex",
    Cursor: "cursor",
    Pi: "pi",
  };
  return map[label] ?? "pi";
}
