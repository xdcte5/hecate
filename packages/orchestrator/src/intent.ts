export type PromptIntent = "chat" | "work";

export interface IntentResult {
  intent: PromptIntent;
  reason: string;
}

// Imperative verbs that mean "do work in the repo", not "answer a question".
const WORK_VERBS =
  /\b(build|create|add|implement|make|write|fix|debug|refactor|restructure|migrate|redesign|scaffold|setup|set up|generate|update|change|remove|delete|rename|install|configure|deploy|test|patch|repair|optimi[sz]e|integrate|wire up|hook up)\b/i;

// Leading question / explanation cues that mean "just talk to me".
const CHAT_OPENERS =
  /^(what|why|how|who|when|where|which|whose|is|are|does|do|can you (explain|tell|describe|summar)|could you (explain|tell|describe)|explain|describe|summar(y|ize|ise)|tell me|walk me through|help me understand|remind me|define|compare|difference between)\b/i;

const CODE_REFERENCE = /\b(this (file|function|class|module|code|repo|project)|the codebase|these changes)\b/i;

/**
 * Decide whether a prompt is chit-chat/Q&A (answer with the conversational model)
 * or work (plan + delegate to agents). Heuristic and deterministic; Hecate is a
 * coding harness, so ambiguous prompts default to `work`.
 */
export function classifyIntent(prompt: string): IntentResult {
  const trimmed = prompt.trim();
  if (!trimmed) return { intent: "work", reason: "empty" };

  const hasWorkVerb = WORK_VERBS.test(trimmed);
  const looksLikeQuestion = CHAT_OPENERS.test(trimmed) || trimmed.endsWith("?");

  // A question that also asks to change code is still work ("why is X broken, fix it").
  if (hasWorkVerb) {
    return { intent: "work", reason: "imperative work verb" };
  }

  if (looksLikeQuestion) {
    // "explain this function" references code but wants an explanation, not edits.
    const detail = CODE_REFERENCE.test(trimmed) ? "question about code" : "natural-language question";
    return { intent: "chat", reason: detail };
  }

  return { intent: "work", reason: "default (no question cue)" };
}
