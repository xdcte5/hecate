import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PiListedModel = {
  provider: string;
  modelId: string;
  /** Pi CLI format: `provider/modelId` */
  spec: string;
};

/** Parse `pi --list-models` tabular output. */
export function parsePiListModels(stdout: string): PiListedModel[] {
  const models: PiListedModel[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("provider")) continue;
    const match = trimmed.match(/^(\S+)\s+(\S+)/);
    if (!match) continue;
    const provider = match[1]!;
    const modelId = match[2]!;
    models.push({ provider, modelId, spec: `${provider}/${modelId}` });
  }
  return models;
}

/** Models available in the user's Pi install (from OAuth / API keys). */
export async function discoverPiListedModels(binary = "pi"): Promise<PiListedModel[]> {
  try {
    const { stdout } = await execFileAsync(binary, ["--list-models"], {
      timeout: 20_000,
      maxBuffer: 512 * 1024,
      env: process.env,
    });
    return parsePiListModels(stdout);
  } catch {
    return [];
  }
}

/** Pick the best Pi model spec for a task from discovered models. */
export function selectPiListedModel(
  listed: PiListedModel[],
  task: string,
): PiListedModel | undefined {
  if (listed.length === 0) return undefined;

  const codex = listed.filter((entry) => entry.provider === "openai-codex");
  const pool = codex.length > 0 ? codex : listed;

  const wantsTests = /\b(test|vitest|jest)\b/i.test(task);
  if (wantsTests) {
    const mini = pool.find((entry) => /mini/i.test(entry.modelId));
    if (mini) return mini;
  }

  const preferred =
    pool.find((entry) => entry.modelId === "gpt-5.4") ??
    pool.find((entry) => /gpt-5\.[4-9]/.test(entry.modelId)) ??
    pool[0];

  return preferred;
}
