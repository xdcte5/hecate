import type { HarnessId } from "@relay/schema";

const AUTO_RUN_PREAMBLE = [
  "Relay is driving this step non-interactively.",
  "Apply file edits and run checks immediately — do not queue changes for approval.",
].join(" ");

export function buildAgentPrompt(task: string, handoffPath: string, autonomous = true): string {
  const lines = [
    "Continue the active Relay product session.",
    `Read ${handoffPath} before acting.`,
  ];
  if (autonomous) {
    lines.push("", AUTO_RUN_PREAMBLE);
  }
  lines.push("", `Task: ${task}`);
  return lines.join("\n");
}

export function buildLaunchArgs(harness: HarnessId, prompt: string, model?: string): string[] {
  switch (harness) {
    case "claude-code": {
      const args = ["-p", "--dangerously-skip-permissions"];
      if (model) args.push("--model", model);
      args.push(prompt);
      return args;
    }
    case "codex": {
      const args = ["exec", "--full-auto"];
      if (model) args.push("-m", model);
      args.push(prompt);
      return args;
    }
    case "cursor": {
      const args = ["-p"];
      if (model) args.push("--model", model);
      args.push(prompt);
      return args;
    }
    case "pi":
      // Pi uses PiRpcDriver; model is passed via spawn args there.
      return model ? [prompt, "--model", model] : [prompt];
    default: {
      const args = ["-p"];
      if (model) args.push("--model", model);
      args.push(prompt);
      return args;
    }
  }
}

export function formatModelLabel(modelId: string): string {
  if (modelId.startsWith("claude-")) {
    const parts = modelId.split("-");
    return parts[1] ?? modelId;
  }
  return modelId;
}
