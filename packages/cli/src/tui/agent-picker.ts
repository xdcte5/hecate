import {
  detectInstalledBinaries,
  detectPiAuthProviders,
  discoverPiListedModels,
} from "@relay/adapters";
import { isModelProviderAvailable } from "@relay/registry";
import type { HarnessId, Registry } from "@relay/schema";
import readline from "node:readline";

export type AgentScanResult = {
  id: HarnessId;
  label: string;
  binaries: string[];
  installed: boolean;
  runnable: boolean;
  installedBinary?: string;
  issue?: string;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
};

export async function scanLocalAgents(
  registry: Registry,
  pathEnv = process.env.PATH ?? "",
): Promise<AgentScanResult[]> {
  const prevPath = process.env.PATH;
  process.env.PATH = pathEnv;
  try {
    const results: AgentScanResult[] = [];
    for (const card of registry.harnesses) {
      const installed = await detectInstalledBinaries(card.binaries);
      const installedBinary = installed[0];
      let runnable = installed.length > 0;
      let issue: string | undefined;

      if (card.id === "pi" && installedBinary) {
        const authProviders = await detectPiAuthProviders();
        if (authProviders.size === 0) {
          runnable = false;
          issue = "auth needed";
        } else {
          const listed = await discoverPiListedModels(installedBinary);
          const hasEligibleModel =
            listed.length > 0 &&
            listed.some((entry) => isModelProviderAvailable(entry.spec, authProviders));
          if (!hasEligibleModel) {
            runnable = false;
            issue = "provider auth mismatch";
          }
        }
      }

      results.push({
        id: card.id,
        label: HARNESS_LABEL[card.id] ?? card.id,
        binaries: card.binaries,
        installed: installed.length > 0,
        runnable,
        installedBinary,
        issue,
      });
    }
    return results;
  } finally {
    process.env.PATH = prevPath;
  }
}

export function formatAgentScanList(scan: AgentScanResult[], enabled: HarnessId[]): string[] {
  return scan.map((agent, index) => {
    const status = agent.installed && agent.runnable
      ? `${agent.installedBinary} ✓`
      : agent.installed
        ? `${agent.installedBinary} ! ${agent.issue ?? "not ready"}`
      : `${agent.binaries.join("|")} ✗`;
    const on = enabled.includes(agent.id) ? "[x]" : "[ ]";
    return `  ${index + 1}. ${on} ${agent.label} — ${status}`;
  });
}

export async function promptAgentSelection(
  scan: AgentScanResult[],
  current: HarnessId[],
  output: NodeJS.WriteStream = process.stdout,
  input: NodeJS.ReadStream = process.stdin,
): Promise<HarnessId[]> {
  const runnable = scan.filter((a) => a.runnable);
  if (runnable.length === 0) {
    output.write("\nNo agent CLIs found on PATH. Install pi, claude, codex, or cursor-agent.\n");
    return [];
  }

  let enabled = new Set(
    current.length > 0 ? current.filter((id) => runnable.some((a) => a.id === id)) : runnable.map((a) => a.id),
  );

  const render = () => {
    output.write("\nSelect agents for this session (toggle numbers, Enter to confirm):\n");
    for (const line of formatAgentScanList(scan, [...enabled])) {
      output.write(`${line}\n`);
    }
    output.write("Toggle (e.g. 1 3) or Enter to save: ");
  };

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    render();

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.close();
        resolve([...enabled]);
        return;
      }

      for (const token of trimmed.split(/\s+/)) {
        const num = Number.parseInt(token, 10);
        if (!Number.isFinite(num) || num < 1 || num > scan.length) continue;
        const agent = scan[num - 1]!;
        if (!agent.runnable) continue;
        if (enabled.has(agent.id)) enabled.delete(agent.id);
        else enabled.add(agent.id);
      }

      if (enabled.size === 0) {
        output.write("At least one runnable agent must stay enabled.\n");
        enabled = new Set(runnable.map((a) => a.id));
      }

      render();
    });

    rl.on("close", () => {
      resolve([...enabled]);
    });
  });
}
