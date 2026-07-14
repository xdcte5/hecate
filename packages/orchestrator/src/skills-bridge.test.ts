import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPiSkillsEnv,
  findRelaySkill,
  formatSkillPromptSection,
  loadRelaySkills,
} from "./skills-bridge.js";

let tmp: string;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("skills-bridge", () => {
  it("loads relay/skills/*.md with frontmatter", async () => {
    tmp = mkdtempSync(join(tmpdir(), "relay-skills-"));
    const skillsDir = join(tmp, "relay", "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, "review.md"),
      `---
name: review
description: Review diffs.
---

Review the code carefully.`,
      "utf8",
    );

    const skills = await loadRelaySkills(tmp);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("review");
    expect(skills[0]?.body).toContain("Review the code");

    const env = buildPiSkillsEnv(tmp, skills);
    expect(env.RELAY_SKILLS_NAMES).toBe("review");
    expect(env.RELAY_SKILLS_PATH).toContain("review.md");

    const section = formatSkillPromptSection(skills, "review");
    expect(section).toContain("Active skill: review");
    expect(findRelaySkill(skills, "skill:review")).not.toBeNull();
  });
});
