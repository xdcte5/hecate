import type { HarnessId, Registry } from "@relay/schema";
import { selectConversationalist } from "@relay/registry";
import { runRawPrompt } from "./run-raw.js";

export interface ConversationOptions {
  cwd: string;
  registry: Registry;
  prompt: string;
  /** Available (installed ∩ enabled) harnesses to pick the conversationalist from. */
  available?: HarnessId[];
  signal?: AbortSignal;
}

export interface ConversationResult {
  ok: boolean;
  harness?: HarnessId;
  model?: string;
  text?: string;
  reason?: string;
}

function buildConversationPrompt(prompt: string): string {
  return [
    "You are Hecate answering conversationally. Respond directly and concisely.",
    "This is a question, not a work order — do not edit files or run commands.",
    "",
    prompt,
  ].join("\n");
}

/**
 * Answer a chit-chat / explanation prompt using the best available
 * conversational model, instead of planning and delegating to agents.
 */
export async function runConversation(options: ConversationOptions): Promise<ConversationResult> {
  const choice = selectConversationalist(options.registry, options.available);
  if (!choice) {
    return { ok: false, reason: "no conversational agent available" };
  }

  const text = await runRawPrompt({
    cwd: options.cwd,
    harness: choice.harness,
    registry: options.registry,
    prompt: buildConversationPrompt(options.prompt),
    model: choice.model,
    signal: options.signal,
  });

  if (!text) {
    return { ok: false, harness: choice.harness, model: choice.model, reason: "no answer" };
  }
  return { ok: true, harness: choice.harness, model: choice.model, text };
}
