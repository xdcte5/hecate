import { CAPABILITY_KEYWORDS } from "@relay/registry";

/** A single decomposed step of work, before harness/model assignment. */
export interface PlannedTask {
  id: string;
  task: string;
  requiredCapabilities: string[];
  wave: number;
}

const CAPABILITY_VOCAB = Object.keys(CAPABILITY_KEYWORDS);

/**
 * Prompt the primary planner to decompose a goal into a strict JSON plan. We
 * ask for JSON specifically so Hecate can "spy on" the planning step and route
 * each task by required capability rather than guessing from keywords.
 */
export function buildPlanningPrompt(goal: string): string {
  return [
    "You are the planning brain of Hecate, a multi-agent coding harness.",
    "Break the user's goal into an ordered list of concrete, independently-runnable steps.",
    "",
    "For each step provide:",
    '- "task": one imperative sentence describing the step.',
    `- "requiredCapabilities": zero or more tags from this vocabulary: ${CAPABILITY_VOCAB.join(", ")}.`,
    '- "wave": integer; steps with the same wave may run in parallel, later waves depend on earlier ones.',
    "",
    "Use native-tool-loop or extensions only when the step needs a persistent autonomous tool loop or editor extensions.",
    "Keep the plan minimal — do not invent testing or review steps unless the goal calls for them.",
    "",
    'Output ONLY a JSON object, no prose, no code fences: {"steps":[{"task":"...","requiredCapabilities":["..."],"wave":0}]}',
    "",
    `Goal: ${goal}`,
  ].join("\n");
}

/** Extract and validate a plan JSON object from a model's raw text output. */
export function parsePlanJson(text: string): PlannedTask[] | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const rawSteps = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;

  const tasks: PlannedTask[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== "object" || raw === null) return null;
    const entry = raw as { task?: unknown; requiredCapabilities?: unknown; wave?: unknown };
    if (typeof entry.task !== "string" || entry.task.trim().length === 0) return null;

    const caps = Array.isArray(entry.requiredCapabilities)
      ? entry.requiredCapabilities.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [];
    const wave = typeof entry.wave === "number" && Number.isInteger(entry.wave) && entry.wave >= 0 ? entry.wave : 0;

    tasks.push({
      id: `step-${tasks.length + 1}`,
      task: entry.task.trim(),
      requiredCapabilities: caps,
      wave,
    });
  }

  return tasks.length > 0 ? tasks : null;
}

/** Find the first balanced top-level JSON object, tolerating code fences/prose around it. */
function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const haystack = fenced ? fenced[1]! : text;
  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i += 1) {
    const ch = haystack[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

export type PlannerFn = (prompt: string) => Promise<string | null>;

/**
 * Generate a structured plan. Runs the injected planner (an LLM call) and parses
 * its JSON; returns null when no planner is available or the output can't be
 * parsed, so the caller can fall back to deterministic decomposition.
 */
export async function generateLlmPlan(goal: string, runPlanner?: PlannerFn): Promise<PlannedTask[] | null> {
  if (!runPlanner) return null;
  let raw: string | null;
  try {
    raw = await runPlanner(buildPlanningPrompt(goal));
  } catch {
    return null;
  }
  if (!raw) return null;
  return parsePlanJson(raw);
}
