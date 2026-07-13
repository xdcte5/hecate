import type { HarnessId, Registry } from "@relay/schema";
import type { ModalController, ModalStep } from "./modal.js";

const HARNESS_LABEL: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  "antigravity": "Antigravity",
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

/**
 * Model choices for a harness. We use the curated registry list rather than
 * scraping `--help` — help text varies wildly per CLI and produced bogus
 * entries (e.g. the word "Model" from a flag description).
 */
export async function discoverHarnessModels(
  harness: HarnessId,
  registry: Registry,
  _binary?: string,
): Promise<{ models: string[]; limitation?: string }> {
  const known = getRegistryModels(registry, harness);
  if (harness === "cursor") {
    return {
      models: known,
      limitation: "Cursor CLI has no --model flag; override shown in plan only.",
    };
  }
  return { models: known };
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

/**
 * Modal that walks each harness that has selectable models and asks for an
 * override (number, model id, or Enter for auto). Driven by the TUI's single
 * readline — no nested stdin reader.
 */
export class ModelPickerModal implements ModalController<Partial<Record<HarnessId, string>>> {
  private index = 0;
  private readonly overrides: Partial<Record<HarnessId, string>> = {};

  constructor(
    private readonly choices: ModelChoice[],
    private readonly write: (text: string) => void,
  ) {}

  /** At least one harness has models to override. */
  get hasSelectableModels(): boolean {
    return this.choices.some((c) => !c.limitation && c.models.length > 0);
  }

  render(): void {
    this.promptCurrent();
  }

  /** Advance to the next harness with models and prompt for it. */
  private promptCurrent(): boolean {
    while (this.index < this.choices.length) {
      const choice = this.choices[this.index]!;
      if (choice.limitation || choice.models.length === 0) {
        this.index += 1;
        continue;
      }
      const label = HARNESS_LABEL[choice.harness];
      this.write(`\n${label} model (Enter = auto):\n`);
      choice.models.forEach((m, i) => this.write(`  ${i + 1}. ${m}\n`));
      this.write(`Pick a number, or Enter for auto: `);
      return true;
    }
    return false;
  }

  handleLine(line: string): ModalStep<Partial<Record<HarnessId, string>>> {
    const choice = this.choices[this.index];
    if (!choice) return { done: true, result: this.overrides };

    const trimmed = line.trim();
    if (trimmed) {
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(num) || num < 1 || num > choice.models.length) {
        // Reject free text (e.g. a mistyped command) instead of saving it as a model id.
        this.write(`  Enter a number 1-${choice.models.length}, or press Enter for auto.\n`);
        this.write(`Pick a number, or Enter for auto: `);
        return { done: false };
      }
      this.overrides[choice.harness] = choice.models[num - 1]!;
    }

    this.index += 1;
    if (this.promptCurrent()) return { done: false };
    return { done: true, result: this.overrides };
  }
}
