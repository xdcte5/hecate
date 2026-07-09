import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarnessId } from "@relay/schema";
import { emptyBuildContext, type Adapter, type GeneratedFile } from "./adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { PiAdapter } from "./pi.js";
import { GeminiAdapter } from "./gemini.js";
import { readRelaySource } from "./source.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtureRoot = join(here, "../../../fixtures/minimal-relay");
const goldenRoot = join(here, "../../../fixtures/golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const adapters: Record<string, Adapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  cursor: new CursorAdapter(),
  pi: new PiAdapter(),
  gemini: new GeminiAdapter(),
};

function walkGolden(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkGolden(full));
    else out.push(full);
  }
  return out;
}

function writeGolden(dir: string, files: GeneratedFile[]): void {
  rmSync(dir, { recursive: true, force: true });
  for (const file of files) {
    const abs = join(dir, file.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, file.content, "utf8");
  }
}

describe("golden adapter output", () => {
  for (const [name, adapter] of Object.entries(adapters)) {
    it(`${name} matches golden fixture`, async () => {
      const source = await readRelaySource(fixtureRoot);
      const files = adapter.generate(source, emptyBuildContext);
      const dir = join(goldenRoot, name);

      if (UPDATE) {
        writeGolden(dir, files);
        return;
      }

      // Every generated file matches its committed golden copy.
      for (const file of files) {
        const goldenPath = join(dir, file.path);
        expect(existsSync(goldenPath), `missing golden: ${file.path}`).toBe(true);
        expect(readFileSync(goldenPath, "utf8")).toBe(file.content);
      }

      // No stale golden files left behind.
      const generatedPaths = new Set(files.map((f) => join(dir, f.path)));
      for (const goldenFile of walkGolden(dir)) {
        expect(generatedPaths.has(goldenFile), `stale golden: ${goldenFile}`).toBe(true);
      }
    });
  }
});

describe("adapter harness ids", () => {
  it("declare their harness", () => {
    const ids: HarnessId[] = Object.values(adapters).map((a) => a.harness);
    expect(ids).toEqual(["claude-code", "codex", "cursor", "pi", "gemini-cli"]);
  });
});

describe("session inject", () => {
  const pointer = ".relay/sessions/abc/HANDOFF.md";

  it("weaves the handoff pointer into every adapter's instructions", async () => {
    const source = await readRelaySource(fixtureRoot);
    for (const adapter of Object.values(adapters)) {
      const files = adapter.generate(source, { handoffPointer: pointer });
      const instructionFile = files.find((f) =>
        /CLAUDE\.md|AGENTS\.md|main\.mdc|GEMINI\.md/.test(f.path),
      );
      expect(instructionFile, `${adapter.harness} has an instruction file`).toBeDefined();
      expect(instructionFile!.content).toContain(pointer);
    }
  });

  it("keeps Codex and Pi AGENTS.md byte-identical under shared instructions", async () => {
    const source = await readRelaySource(fixtureRoot);
    const ctx = { handoffPointer: pointer };
    const codexAgents = adapters.codex!.generate(source, ctx).find((f) => f.path === "AGENTS.md");
    const piAgents = adapters.pi!.generate(source, ctx).find((f) => f.path === "AGENTS.md");
    expect(codexAgents!.content).toBe(piAgents!.content);
  });
});
