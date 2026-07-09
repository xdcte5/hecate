import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import type { HarnessId, Registry } from "@relay/schema";

const execFileAsync = promisify(execFile);

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "gemini-cli": "Gemini",
};

export type ModelChoice = {
  harness: HarnessId;
  models: string[];
  selected?: string;
  limitation?: string;
};

export function getRegistryModels(registry: Registry, harness: HarnessId): string[] {
  const card = registry.harnesses.find((entry) => entry.id === harness);
  return card?.models?.map((model) => model.id) ?? [];
}

export async function discoverHarnessModels(
  harness: HarnessId,
  registry: Registry,
  binary?: string,
): Promise<{ models: string[]; limitation?: string }> {
  const known = getRegistryModels(registry, harness);

  if (harness === "cursor") {
    return {
      models: known,
      limitation: "Cursor CLI has no --model flag; override shown in plan only.",
    };
  }

  if (!binary) {
    return { models: known };
  }

  try {
    const { stdout } = await execFileAsync(binary, ["--help"], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    const fromHelp = parseModelsFromHelp(stdout);
    const merged = [...new Set([...known, ...fromHelp])];
    return { models: merged.length > 0 ? merged : known };
  } catch {
    return { models: known };
  }
}

function parseModelsFromHelp(text: string): string[] {
  const models: string[] = [];
  const modelFlag = /--model[=\s]+([^\s,\]]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = modelFlag.exec(text)) !== null) {
    const id = match[1]!.replace(/["']/g, "");
    if (id && !id.startsWith("<")) models.push(id);
  }
  return models;
}

export function formatModelChoices(choices: ModelChoice[]): string[] {
  const lines: string[] = ["Model overrides (blank = ability-based auto):"];
  for (const choice of choices) {
    const label = HARNESS_LABEL[choice.harness];
    if (choice.limitation) {
      lines.push(`  ${label}: ${choice.limitation}`);
      continue;
    }
    const selected = choice.selected ?? "(auto)";
    lines.push(`  ${label}: ${selected}`);
    if (choice.models.length > 0) {
      lines.push(`    available: ${choice.models.join(", ")}`);
    }
  }
  return lines;
}

export async function promptModelSelection(
  choices: ModelChoice[],
  output: NodeJS.WriteStream = process.stdout,
  input: NodeJS.ReadStream = process.stdin,
): Promise<Partial<Record<HarnessId, string>>> {
  const overrides: Partial<Record<HarnessId, string>> = {};

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    let index = 0;

    const askNext = () => {
      while (index < choices.length) {
        const choice = choices[index]!;
        if (choice.limitation || choice.models.length === 0) {
          index += 1;
          continue;
        }
        const label = HARNESS_LABEL[choice.harness];
        output.write(`\n${label} model (auto=Enter):\n`);
        choice.models.forEach((m, i) => output.write(`  ${i + 1}. ${m}\n`));
        output.write(`Pick number, type model id, or Enter for auto: `);
        return;
      }
      rl.close();
      resolve(overrides);
    };

    rl.on("line", (line) => {
      const trimmed = line.trim();
      const choice = choices[index];
      if (!choice) {
        rl.close();
        resolve(overrides);
        return;
      }

      if (!trimmed) {
        index += 1;
        askNext();
        return;
      }

      const num = Number.parseInt(trimmed, 10);
      if (Number.isFinite(num) && num >= 1 && num <= choice.models.length) {
        overrides[choice.harness] = choice.models[num - 1]!;
      } else {
        overrides[choice.harness] = trimmed;
      }
      index += 1;
      askNext();
    });

    askNext();
  });
}
