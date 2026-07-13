import { detectInstalledBinaries } from "@relay/adapters";
import type { HarnessId, Registry } from "@relay/schema";
import type { ModalController, ModalStep } from "./modal.js";

export type AgentScanResult = {
  id: HarnessId;
  label: string;
  binaries: string[];
  installed: boolean;
  installedBinary?: string;
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "antigravity": "Antigravity",
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
      results.push({
        id: card.id,
        label: HARNESS_LABEL[card.id] ?? card.id,
        binaries: card.binaries,
        installed: installed.length > 0,
        installedBinary: installed[0],
      });
    }
    return results;
  } finally {
    process.env.PATH = prevPath;
  }
}

export function formatAgentScanList(scan: AgentScanResult[], enabled: HarnessId[]): string[] {
  return scan.map((agent, index) => {
    const status = agent.installed
      ? `${agent.installedBinary} ✓`
      : `${agent.binaries.join("|")} ✗`;
    const on = enabled.includes(agent.id) ? "[x]" : "[ ]";
    return `  ${index + 1}. ${on} ${agent.label} — ${status}`;
  });
}

/**
 * Modal for toggling which installed agents this session may use. Driven by the
 * TUI's single readline — it never opens its own stdin reader. Toggling a number
 * that is not installed reports why instead of silently doing nothing.
 */
export class AgentPickerModal implements ModalController<HarnessId[]> {
  private enabled: Set<HarnessId>;
  private readonly installed: AgentScanResult[];

  constructor(
    private readonly scan: AgentScanResult[],
    current: HarnessId[],
    private readonly write: (text: string) => void,
  ) {
    this.installed = scan.filter((a) => a.installed);
    this.enabled = new Set(
      current.length > 0
        ? current.filter((id) => this.installed.some((a) => a.id === id))
        : this.installed.map((a) => a.id),
    );
  }

  /** No agents on PATH — nothing to toggle. */
  get hasInstalledAgents(): boolean {
    return this.installed.length > 0;
  }

  render(): void {
    this.write("\nSelect agents for this session (toggle numbers, Enter to confirm):\n");
    for (const line of formatAgentScanList(this.scan, [...this.enabled])) {
      this.write(`${line}\n`);
    }
    this.write("Toggle (e.g. 1 3) or Enter to save: ");
  }

  handleLine(line: string): ModalStep<HarnessId[]> {
    const trimmed = line.trim();
    if (!trimmed) {
      return { done: true, result: [...this.enabled] };
    }

    for (const token of trimmed.split(/\s+/)) {
      const num = Number.parseInt(token, 10);
      if (!Number.isFinite(num) || num < 1 || num > this.scan.length) {
        this.write(`  "${token}" is not one of the listed numbers.\n`);
        continue;
      }
      const agent = this.scan[num - 1]!;
      if (!agent.installed) {
        this.write(
          `  ${agent.label} is not installed (${agent.binaries.join("|")} not on PATH) — install it to enable.\n`,
        );
        continue;
      }
      if (this.enabled.has(agent.id)) this.enabled.delete(agent.id);
      else this.enabled.add(agent.id);
    }

    if (this.enabled.size === 0) {
      this.write("  At least one installed agent must stay enabled.\n");
      this.enabled = new Set(this.installed.map((a) => a.id));
    }

    this.render();
    return { done: false };
  }
}
