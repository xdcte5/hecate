import type { HandoffBundle } from "@relay/schema";

function formatDecisions(bundle: HandoffBundle): string {
  if (bundle.decisions.length === 0) return "(none)";
  return bundle.decisions
    .slice(-10)
    .map((d) => `- ${d.text}${d.rationale ? ` — ${d.rationale}` : ""}`)
    .join("\n");
}

function formatTodos(bundle: HandoffBundle): string {
  const open = bundle.todos.filter((t) => t.status !== "done");
  if (open.length === 0) return "(none)";
  return open.map((t) => {
    const mark = t.status === "in_progress" ? "~" : " ";
    return `- [${mark}] ${t.text}`;
  }).join("\n");
}

function formatGit(bundle: HandoffBundle): string {
  if (!bundle.git) return "(no git snapshot)";
  const lines = [
    `- Branch: \`${bundle.git.branch}\``,
    `- HEAD: \`${bundle.git.head.slice(0, 12)}\``,
  ];
  if (bundle.git.remote) lines.push(`- Remote: \`${bundle.git.remote}\``);
  if (bundle.git.dirty_files.length > 0) {
    lines.push(`- Changed files: ${bundle.git.dirty_files.map((f) => `\`${f}\``).join(", ")}`);
  }
  return lines.join("\n");
}

export function renderHandoffMarkdown(bundle: HandoffBundle): string {
  const source = bundle.sourceHarness ?? "unknown";
  return [
    "# Relay Handoff",
    "",
    `> Prepared for **${bundle.targetHarness}** (handoff #${bundle.handoffSeq})`,
    "",
    "## Goal",
    bundle.goal,
    "",
    "## Context",
    `- Session: \`${bundle.sessionId}\``,
    `- From: \`${source}\``,
    `- Prepared: ${bundle.prepared_at}`,
    "",
    "## Git state",
    formatGit(bundle),
    "",
    "## Decisions",
    formatDecisions(bundle),
    "",
    "## Open TODOs",
    formatTodos(bundle),
    "",
    "## Instructions",
    "Read this file first. For machine import, use `handoff.json` in the same directory.",
    "",
  ].join("\n");
}
