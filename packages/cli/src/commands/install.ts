import { Command } from "commander";
import { detectInstalledBinaries } from "@relay/adapters";

export type AgentBinarySpec = {
  harness: string;
  binaries: string[];
  hint: string;
};

export const AGENT_BINARY_SPECS: AgentBinarySpec[] = [
  {
    harness: "Claude Code",
    binaries: ["claude"],
    hint: "npm install -g @anthropic-ai/claude-code",
  },
  {
    harness: "Codex",
    binaries: ["codex"],
    hint: "npm install -g @openai/codex",
  },
  {
    harness: "Cursor",
    binaries: ["cursor-agent"],
    hint: "Install Cursor Agent CLI — see https://docs.cursor.com/cli",
  },
  {
    harness: "Pi",
    binaries: ["pi"],
    hint: "npm install -g @mariozechner/pi-coding-agent",
  },
];

export type AgentBinaryStatus = {
  harness: string;
  binaries: string[];
  installed: boolean;
  resolvedPath?: string;
  hint: string;
};

export async function checkAgentBinaries(): Promise<AgentBinaryStatus[]> {
  const results: AgentBinaryStatus[] = [];

  for (const spec of AGENT_BINARY_SPECS) {
    const installed = await detectInstalledBinaries(spec.binaries);
    results.push({
      harness: spec.harness,
      binaries: spec.binaries,
      installed: installed.length > 0,
      resolvedPath: installed[0],
      hint: spec.hint,
    });
  }

  return results;
}

export function formatInstallReport(statuses: AgentBinaryStatus[]): string[] {
  const lines: string[] = ["Agent CLI install check:"];

  for (const status of statuses) {
    if (status.installed) {
      lines.push(`  ✓ ${status.harness} — ${status.resolvedPath ?? status.binaries[0]}`);
    } else {
      const names = status.binaries.join("|");
      lines.push(`  ✗ ${status.harness} — ${names} not found`);
      lines.push(`    fix: ${status.hint}`);
    }
  }

  const missing = statuses.filter((status) => !status.installed);
  if (missing.length === 0) {
    lines.push("");
    lines.push("All agent CLIs are available.");
  } else {
    lines.push("");
    lines.push(`${missing.length} agent CLI(s) missing — install the binaries above, then re-run \`relay install\`.`);
  }

  return lines;
}

export async function runInstall(): Promise<boolean> {
  const statuses = await checkAgentBinaries();
  for (const line of formatInstallReport(statuses)) {
    console.log(line);
  }
  return statuses.every((status) => status.installed);
}

export function registerInstallCommands(program: Command): void {
  program
    .command("install")
    .description("Check agent CLI binaries on PATH and print install hints")
    .action(async () => {
      const ok = await runInstall();
      if (!ok) process.exitCode = 1;
    });
}
