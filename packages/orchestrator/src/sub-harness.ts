import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RelayAgent = {
  name: string;
  description: string;
  path: string;
  body: string;
};

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  const frontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: body.trim() };
}

function relayAgentsDir(cwd: string): string {
  return join(cwd, "relay", "agents");
}

/** Load `relay/agents/*.md` sub-harness definitions (slash-command stubs). */
export async function loadRelayAgents(cwd: string): Promise<RelayAgent[]> {
  const dir = relayAgentsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const agents: RelayAgent[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    const raw = await readFile(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const fallbackName = entry.replace(/\.md$/, "");
    agents.push({
      name: meta.name ?? fallbackName,
      description: meta.description ?? "",
      path: resolve(path),
      body,
    });
  }
  return agents;
}

/** Resolve a sub-harness agent by name (case-insensitive). */
export async function resolveSubHarness(cwd: string, name: string): Promise<RelayAgent | null> {
  const agents = await loadRelayAgents(cwd);
  const normalized = name.trim().toLowerCase().replace(/^agent:/, "");
  return agents.find((agent) => agent.name.toLowerCase() === normalized) ?? null;
}

/** Build a child-harness prompt from an agent definition (stub — Sprint 7). */
export function formatSubHarnessPrompt(agent: RelayAgent, task: string, handoffPath: string): string {
  return [
    "Relay sub-harness invocation.",
    `Agent: ${agent.name}`,
    agent.description ? `Role: ${agent.description}` : "",
    `Read ${handoffPath} before acting.`,
    "",
    agent.body,
    "",
    `Task: ${task}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/** List slash-command names for TUI help (`/agent:reviewer`). */
export async function listSubHarnessCommands(cwd: string): Promise<string[]> {
  const agents = await loadRelayAgents(cwd);
  return agents.map((agent) => `agent:${agent.name}`);
}
