import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "@relay/schema";

export type ModelMode = "auto" | "manual";

export type LocalConfig = {
  enabledAgents: HarnessId[];
  modelOverrides: Partial<Record<HarnessId, string>>;
  modelMode: ModelMode;
  /** Force the next orchestrated run onto this harness, then clear. */
  harnessOverride?: HarnessId;
  /** Force the next orchestrated run onto this model, then clear. */
  nextModelOverride?: string;
};

export const LOCAL_CONFIG_RELATIVE = join(".relay", "local-config.json");

const DEFAULT_CONFIG: LocalConfig = {
  enabledAgents: [],
  modelOverrides: {},
  modelMode: "auto",
};

export function defaultLocalConfig(): LocalConfig {
  return { ...DEFAULT_CONFIG, enabledAgents: [], modelOverrides: {} };
}

export function localConfigPath(cwd: string): string {
  return join(cwd, LOCAL_CONFIG_RELATIVE);
}

export async function readLocalConfig(cwd: string): Promise<LocalConfig> {
  try {
    const raw = await readFile(localConfigPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;
    return {
      enabledAgents: Array.isArray(parsed.enabledAgents) ? parsed.enabledAgents : [],
      modelOverrides:
        parsed.modelOverrides && typeof parsed.modelOverrides === "object"
          ? parsed.modelOverrides
          : {},
      modelMode: parsed.modelMode === "manual" ? "manual" : "auto",
      harnessOverride:
        typeof parsed.harnessOverride === "string" ? (parsed.harnessOverride as HarnessId) : undefined,
      nextModelOverride:
        typeof parsed.nextModelOverride === "string" ? parsed.nextModelOverride : undefined,
    };
  } catch {
    return defaultLocalConfig();
  }
}

export async function writeLocalConfig(cwd: string, config: LocalConfig): Promise<void> {
  await mkdir(join(cwd, ".relay"), { recursive: true });
  const payload: LocalConfig = {
    enabledAgents: config.enabledAgents,
    modelOverrides: config.modelOverrides,
    modelMode: config.modelMode,
    ...(config.harnessOverride ? { harnessOverride: config.harnessOverride } : {}),
    ...(config.nextModelOverride ? { nextModelOverride: config.nextModelOverride } : {}),
  };
  await writeFile(localConfigPath(cwd), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function formatLocalConfigSummary(config: LocalConfig): string[] {
  const agents =
    config.enabledAgents.length > 0 ? config.enabledAgents.join(", ") : "(none — run agents)";
  const overrides = Object.entries(config.modelOverrides);
  const modelLines =
    overrides.length > 0
      ? overrides.map(([h, m]) => `  ${h}: ${m}`)
      : ["  (none — ability-based auto)"];
  const pending: string[] = [];
  if (config.harnessOverride) pending.push(`Next harness: ${config.harnessOverride}`);
  if (config.nextModelOverride) pending.push(`Next model: ${config.nextModelOverride}`);
  return [
    `Enabled agents: ${agents}`,
    `Model mode: ${config.modelMode}`,
    "Model overrides:",
    ...modelLines,
    ...(pending.length > 0 ? ["Pending overrides:", ...pending.map((line) => `  ${line}`)] : []),
  ];
}
