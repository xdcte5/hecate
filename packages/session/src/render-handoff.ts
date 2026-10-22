import type { HandoffBundle } from "@relay/schema";
import type { HandoffTier } from "./rhp-builder.js";

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

function formatChangedPaths(bundle: HandoffBundle): string {
  if (!bundle.git || bundle.git.dirty_files.length === 0) return "(none)";
  return bundle.git.dirty_files.map((f) => `- \`${f}\``).join("\n");
}

function formatGit(bundle: HandoffBundle, tier: HandoffTier): string {
  if (!bundle.git) return "(no git snapshot)";

  const lines = [
    `- Branch: \`${bundle.git.branch}\``,
    `- HEAD: \`${bundle.git.head.slice(0, 12)}\``,
  ];
  if (bundle.git.remote) lines.push(`- Remote: \`${bundle.git.remote}\``);

  if (tier === "review" && bundle.git.dirty_files.length > 0) {
    lines.push(`- Changed: ${bundle.git.dirty_files.length} file(s)`);
    lines.push(`- Paths: ${bundle.git.dirty_files.map((f) => `\`${f}\``).join(", ")}`);
  } else if (bundle.git.dirty_files.length > 0) {
    lines.push(`- Changed files: ${bundle.git.dirty_files.map((f) => `\`${f}\``).join(", ")}`);
  }

  return lines.join("\n");
}

function formatTestHint(testHint?: string): string {
  return testHint ?? "Run the project test suite (e.g. `pnpm test`).";
}

export function renderHandoffMarkdown(
  bundle: HandoffBundle,
  tier: HandoffTier = "full",
  testHint?: string,
): string {
  const source = bundle.sourceHarness ?? "unknown";
  const sections: string[] = [
    "# Relay Handoff",
    "",
    `> Prepared for **${bundle.targetHarness}** (handoff #${bundle.handoffSeq})`,
    "",
    "## Goal",
    bundle.goal,
    "",
  ];

  if (tier !== "debug") {
    sections.push(
      "## Context",
      `- Session: \`${bundle.sessionId}\``,
      `- From: \`${source}\``,
      `- Prepared: ${bundle.prepared_at}`,
      "",
    );
  }

  switch (tier) {
    case "implement":
      sections.push("## Decisions", formatDecisions(bundle), "", "## Open TODOs", formatTodos(bundle), "");
      break;
    case "test":
      sections.push(
        "## Changed files",
        formatChangedPaths(bundle),
        "",
        "## Test hint",
        formatTestHint(testHint),
        "",
      );
      break;
    case "review":
      sections.push(
        "## Git state",
        formatGit(bundle, tier),
        "",
        "## Decisions",
        formatDecisions(bundle),
        "",
      );
      break;
    case "debug":
      sections.push(
        "## Error context",
        formatDecisions(bundle),
        "",
        "## Last active task",
        formatTodos(bundle),
        "",
        "## Changed files",
        formatChangedPaths(bundle),
        "",
      );
      break;
    case "full":
    default:
      sections.push(
        "## Git state",
        formatGit(bundle, tier),
        "",
        "## Decisions",
        formatDecisions(bundle),
        "",
        "## Open TODOs",
        formatTodos(bundle),
        "",
      );
      break;
  }

  sections.push(
    "## Instructions",
    "Read this file first. For machine import, use `handoff.json` in the same directory.",
    "",
  );

  return sections.join("\n");
}
