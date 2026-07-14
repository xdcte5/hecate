import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RelaySkill = {
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

function relaySkillsDir(cwd: string): string {
  return join(cwd, "relay", "skills");
}

/** Load `relay/skills/*.md` skill definitions for Pi RPC sessions. */
export async function loadRelaySkills(cwd: string): Promise<RelaySkill[]> {
  const dir = relaySkillsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: RelaySkill[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    const raw = await readFile(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const fallbackName = entry.replace(/\.md$/, "");
    skills.push({
      name: meta.name ?? fallbackName,
      description: meta.description ?? "",
      path: resolve(path),
      body,
    });
  }
  return skills;
}

/** Resolve a skill by name (case-insensitive, strips optional `skill:` prefix). */
export function findRelaySkill(skills: RelaySkill[], name: string): RelaySkill | null {
  const normalized = name.trim().toLowerCase().replace(/^skill:/, "");
  return skills.find((skill) => skill.name.toLowerCase() === normalized) ?? null;
}

/** Append skill bodies to the agent prompt when a skill is active. */
export function formatSkillPromptSection(skills: RelaySkill[], activeSkill?: string): string {
  if (!activeSkill) return "";
  const skill = findRelaySkill(skills, activeSkill);
  if (!skill) return "";

  const lines = [
    "",
    `## Active skill: ${skill.name}`,
    skill.description ? skill.description : "",
    "",
    skill.body,
  ].filter((line) => line.length > 0);
  return lines.join("\n");
}

/** Pi RPC spawn env vars for skills discovery. */
export function buildPiSkillsEnv(cwd: string, skills: RelaySkill[]): Record<string, string> {
  if (skills.length === 0) return {};
  return {
    RELAY_SKILLS_PATH: skills.map((skill) => skill.path).join(":"),
    RELAY_SKILLS_NAMES: skills.map((skill) => skill.name).join(","),
    RELAY_SKILLS_DIR: resolve(relaySkillsDir(cwd)),
  };
}

/** Catalog block for the agent prompt listing available Relay skills. */
export function formatSkillsCatalog(skills: RelaySkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}`,
  );
  return ["", "## Relay skills (relay/skills/)", ...lines].join("\n");
}
