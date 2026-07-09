import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HarnessIdSchema } from "@relay/schema";

/**
 * `relay/orchestrator.yaml` — the deep-customization surface for the
 * super-harness. Every knob is optional; omitted keys fall back to built-in
 * defaults so the file can be as thin or as detailed as the user wants.
 */
export const OrchestratorConfigSchema = z.object({
  /** Max agents to run concurrently within a wave (default: unbounded). */
  maxConcurrency: z.number().int().positive().optional(),
  /** Run independent tasks as isolated child sub-sessions (default: true). */
  subSessions: z.boolean().optional(),
  /** Per-step-kind harness override, e.g. { implement: "pi", test: "codex" }. */
  routing: z.record(z.string(), HarnessIdSchema).optional(),
  /** Per-harness model override, e.g. { "claude-code": "claude-opus-4-6" }. */
  models: z.partialRecord(HarnessIdSchema, z.string()).optional(),
  /** Verification gates between waves. */
  verify: z
    .object({
      enabled: z.boolean().optional(),
      command: z.string().optional(),
    })
    .optional(),
  /** Per-harness native login args, overriding built-in defaults. */
  login: z.partialRecord(HarnessIdSchema, z.array(z.string())).optional(),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

export const ORCHESTRATOR_CONFIG_RELATIVE = join("relay", "orchestrator.yaml");

export function emptyOrchestratorConfig(): OrchestratorConfig {
  return {};
}

/** Load `relay/orchestrator.yaml`, returning an empty config when absent. */
export async function loadOrchestratorConfig(cwd: string): Promise<OrchestratorConfig> {
  try {
    const raw = await readFile(join(cwd, ORCHESTRATOR_CONFIG_RELATIVE), "utf8");
    const parsed = parseYaml(raw) as unknown;
    if (parsed == null) return emptyOrchestratorConfig();
    return OrchestratorConfigSchema.parse(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyOrchestratorConfig();
    throw err;
  }
}

/** One-line-per-setting summary for `relay config`. */
export function formatOrchestratorConfig(config: OrchestratorConfig): string[] {
  const lines: string[] = [];
  lines.push(`concurrency:  ${config.maxConcurrency ?? "unbounded"}`);
  lines.push(`sub-sessions: ${config.subSessions === false ? "off" : "on"}`);
  lines.push(`verify:       ${config.verify?.enabled === false ? "off" : "on"}${config.verify?.command ? ` (${config.verify.command})` : ""}`);
  const routing = config.routing ? Object.entries(config.routing) : [];
  lines.push(`routing:      ${routing.length ? routing.map(([k, v]) => `${k}→${v}`).join(", ") : "(auto)"}`);
  const models = config.models ? Object.entries(config.models) : [];
  lines.push(`models:       ${models.length ? models.map(([k, v]) => `${k}=${v}`).join(", ") : "(auto)"}`);
  const login = config.login ? Object.keys(config.login) : [];
  lines.push(`login args:   ${login.length ? login.join(", ") : "(defaults)"}`);
  return lines;
}
