import { describe, it, expect } from "vitest";
import { emptyRhpV1 } from "@relay/schema";
import {
  buildHandoffArtifacts,
  enforceMaxHandoffTokens,
  estimateHandoffTokens,
  handoffTierForTaskType,
} from "./rhp-builder.js";
import { renderHandoffMarkdown } from "./render-handoff.js";

const sampleGit = {
  remote: "git@github.com:acme/app.git",
  branch: "main",
  head: "abc123def4567890abcdef1234567890abcdef12",
  dirty_files: ["src/auth.ts", "src/login.ts"],
  staged_diff: "diff --git a/src/auth.ts\n+const x = 1;\n".repeat(200),
  unstaged_diff: "diff --git a/src/login.ts\n+const y = 2;\n".repeat(200),
};

describe("rhp-builder", () => {
  it("builds valid handoff bundle and markdown (full tier)", () => {
    const session = emptyRhpV1("sess-1", "oauth-login", "claude-code");
    session.decisions.push({
      id: "d1",
      at: new Date().toISOString(),
      text: "Use JWT for auth",
      rationale: "stateless API",
    });
    session.todos.push({
      id: "t1",
      text: "Add login form",
      status: "pending",
    });

    const { bundle, handoffJson, handoffMarkdown } = buildHandoffArtifacts(
      session,
      "cursor",
      sampleGit,
      { tier: "full" },
    );

    expect(bundle.targetHarness).toBe("cursor");
    expect(bundle.sourceHarness).toBe("claude-code");
    expect(bundle.handoffSeq).toBe(1);
    expect(bundle.git?.dirty_files).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(bundle.git?.staged_diff).toBeTruthy();

    const parsed = JSON.parse(handoffJson);
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.rhp_version).toBe("1");

    expect(handoffMarkdown).toContain("# Relay Handoff");
    expect(handoffMarkdown).toContain("oauth-login");
    expect(handoffMarkdown).toContain("Use JWT for auth");
    expect(renderHandoffMarkdown(bundle, "full")).toBe(handoffMarkdown);
  });

  it("trims oversized handoff bundles to maxHandoffTokens", () => {
    const session = emptyRhpV1("sess-2", "x".repeat(5000), "pi");
    for (let i = 0; i < 50; i += 1) {
      session.decisions.push({
        id: `d-${i}`,
        at: new Date().toISOString(),
        text: `Decision ${i}: ${"detail ".repeat(40)}`,
      });
    }

    const { bundle } = buildHandoffArtifacts(session, "codex", undefined, { maxTokens: 200 });
    expect(bundle.decisions.length).toBeLessThan(50);
    expect(JSON.stringify(bundle).length).toBeLessThan(5000);
  });

  it("implement tier omits git snapshot and diffs", () => {
    const session = emptyRhpV1("sess-3", "add feature", "claude-code");
    session.decisions.push({
      id: "d1",
      at: new Date().toISOString(),
      text: "Use REST",
    });
    session.todos.push({ id: "t1", text: "Wire API", status: "pending" });

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "codex", sampleGit, {
      tier: "implement",
    });

    expect(bundle.git).toBeUndefined();
    expect(bundle.decisions).toHaveLength(1);
    expect(bundle.todos).toHaveLength(1);
    expect(handoffMarkdown).not.toContain("staged_diff");
    expect(handoffMarkdown).not.toContain("Git state");
    expect(handoffMarkdown).toContain("Wire API");
  });

  it("test tier includes changed paths and test hint, omits diff blobs", () => {
    const session = emptyRhpV1("sess-4", "add tests", "codex");
    session.decisions.push({
      id: "d1",
      at: new Date().toISOString(),
      text: "Use vitest",
    });

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "claude-code", sampleGit, {
      tier: "test",
      testHint: "pnpm vitest run",
    });

    expect(bundle.decisions).toHaveLength(0);
    expect(bundle.todos).toHaveLength(0);
    expect(bundle.git?.dirty_files).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(bundle.git?.staged_diff).toBeUndefined();
    expect(bundle.git?.unstaged_diff).toBeUndefined();
    expect(handoffMarkdown).toContain("src/auth.ts");
    expect(handoffMarkdown).toContain("pnpm vitest run");
    expect(handoffMarkdown).not.toContain("Use vitest");
  });

  it("review tier includes decisions and paths without full diffs", () => {
    const session = emptyRhpV1("sess-5", "review changes", "claude-code");
    session.decisions.push({
      id: "d1",
      at: new Date().toISOString(),
      text: "Check auth boundary",
    });

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "codex", sampleGit, {
      tier: "review",
    });

    expect(bundle.git?.staged_diff).toBeUndefined();
    expect(bundle.git?.unstaged_diff).toBeUndefined();
    expect(bundle.git?.dirty_files).toHaveLength(2);
    expect(bundle.decisions).toHaveLength(1);
    expect(bundle.todos).toHaveLength(0);
    expect(handoffMarkdown).toContain("Changed: 2 file(s)");
    expect(handoffMarkdown).toContain("Check auth boundary");
  });

  it("debug tier keeps last decision and active todo only", () => {
    const session = emptyRhpV1("sess-6", "fix login bug", "pi");
    session.decisions.push(
      { id: "d1", at: new Date().toISOString(), text: "Earlier note" },
      { id: "d2", at: new Date().toISOString(), text: "TypeError in auth.ts:42" },
    );
    session.todos.push(
      { id: "t1", text: "Reproduce bug", status: "done" },
      { id: "t2", text: "pnpm test src/auth.test.ts", status: "in_progress" },
    );

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "codex", sampleGit, {
      tier: "debug",
    });

    expect(bundle.decisions).toHaveLength(1);
    expect(bundle.decisions[0]?.text).toBe("TypeError in auth.ts:42");
    expect(bundle.todos).toHaveLength(1);
    expect(bundle.todos[0]?.text).toBe("pnpm test src/auth.test.ts");
    expect(handoffMarkdown).toContain("Error context");
    expect(handoffMarkdown).toContain("Last active task");
  });

  it("enforceMaxHandoffTokens strips git diffs before trimming decisions", () => {
    const session = emptyRhpV1("sess-7", "goal", "pi");
    const { bundle } = buildHandoffArtifacts(session, "codex", sampleGit, { tier: "full" });
    const trimmed = enforceMaxHandoffTokens(bundle, 100, "full");

    expect(trimmed.git?.staged_diff).toBeUndefined();
    expect(trimmed.git?.unstaged_diff).toBeUndefined();
    expect(estimateHandoffTokens(JSON.stringify(trimmed))).toBeLessThanOrEqual(100);
  });

  it("handoffTierForTaskType maps step types to tiers", () => {
    expect(handoffTierForTaskType("implement")).toBe("implement");
    expect(handoffTierForTaskType("implement-frontend")).toBe("implement");
    expect(handoffTierForTaskType("test")).toBe("test");
    expect(handoffTierForTaskType("review")).toBe("review");
    expect(handoffTierForTaskType("refactor")).toBe("review");
    expect(handoffTierForTaskType("fix")).toBe("debug");
    expect(handoffTierForTaskType("unknown")).toBe("full");
  });

  it("review tier trims diff blobs and enforces maxHandoffTokens", () => {
    const session = emptyRhpV1("sess-review-cap", "review auth changes", "claude-code");
    for (let i = 0; i < 30; i += 1) {
      session.decisions.push({
        id: `d-${i}`,
        at: new Date().toISOString(),
        text: `Decision ${i}: ${"boundary ".repeat(30)}`,
      });
    }

    const hugeGit = {
      ...sampleGit,
      dirty_files: Array.from({ length: 40 }, (_, i) => `src/file-${i}.ts`),
      staged_diff: "diff --git a/src/auth.ts\n+const x = 1;\n".repeat(500),
      unstaged_diff: "diff --git a/src/login.ts\n+const y = 2;\n".repeat(500),
    };

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "codex", hugeGit, {
      tier: "review",
      maxTokens: 300,
    });

    expect(bundle.git?.staged_diff).toBeUndefined();
    expect(bundle.git?.unstaged_diff).toBeUndefined();
    expect(bundle.decisions.length).toBeLessThan(30);
    expect(
      estimateHandoffTokens(JSON.stringify(bundle) + handoffMarkdown),
    ).toBeLessThanOrEqual(300);
    expect(handoffMarkdown).not.toContain("diff --git");
  });

  it("test tier omits verbose content and enforces maxHandoffTokens", () => {
    const session = emptyRhpV1("sess-test-cap", "x".repeat(4000), "codex");
    for (let i = 0; i < 20; i += 1) {
      session.decisions.push({
        id: `d-${i}`,
        at: new Date().toISOString(),
        text: `Verbose decision ${i}: ${"context ".repeat(50)}`,
      });
      session.todos.push({
        id: `t-${i}`,
        text: `Todo ${i}: ${"work ".repeat(20)}`,
        status: "pending",
      });
    }

    const verboseGit = {
      ...sampleGit,
      dirty_files: Array.from({ length: 25 }, (_, i) => `tests/case-${i}.test.ts`),
      staged_diff: "diff --git a/tests/a.test.ts\n+test();\n".repeat(300),
      unstaged_diff: "diff --git a/tests/b.test.ts\n+test();\n".repeat(300),
    };

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "claude-code", verboseGit, {
      tier: "test",
      maxTokens: 250,
      testHint: "pnpm vitest run",
    });

    expect(bundle.decisions).toHaveLength(0);
    expect(bundle.todos).toHaveLength(0);
    expect(bundle.git?.staged_diff).toBeUndefined();
    expect(bundle.git?.unstaged_diff).toBeUndefined();
    expect(bundle.git?.dirty_files.length).toBeLessThan(25);
    expect(session.goal.length).toBeGreaterThan(bundle.goal.length);
    expect(
      estimateHandoffTokens(JSON.stringify(bundle) + handoffMarkdown),
    ).toBeLessThanOrEqual(250);
    expect(handoffMarkdown).toContain("pnpm vitest run");
    expect(handoffMarkdown).not.toContain("Verbose decision");
    expect(handoffMarkdown).not.toContain("diff --git");
  });

  it("debug tier enforces maxHandoffTokens while keeping error context", () => {
    const session = emptyRhpV1("sess-debug-cap", "fix login bug", "pi");
    session.decisions.push(
      { id: "d1", at: new Date().toISOString(), text: "Earlier note" },
      { id: "d2", at: new Date().toISOString(), text: "TypeError in auth.ts:42" },
    );
    session.todos.push(
      { id: "t1", text: "Reproduce bug", status: "done" },
      { id: "t2", text: "pnpm test src/auth.test.ts", status: "in_progress" },
    );

    const { bundle, handoffMarkdown } = buildHandoffArtifacts(session, "codex", sampleGit, {
      tier: "debug",
      maxTokens: 220,
    });

    expect(bundle.decisions.length).toBeGreaterThan(0);
    expect(bundle.decisions.at(-1)?.text).toBe("TypeError in auth.ts:42");
    expect(bundle.todos.length).toBeGreaterThan(0);
    expect(bundle.git?.staged_diff).toBeUndefined();
    expect(
      estimateHandoffTokens(JSON.stringify(bundle) + handoffMarkdown),
    ).toBeLessThanOrEqual(220);
  });

  it("implement tier enforces maxHandoffTokens without git snapshot", () => {
    const session = emptyRhpV1("sess-impl-cap", "y".repeat(3000), "claude-code");
    for (let i = 0; i < 25; i += 1) {
      session.decisions.push({
        id: `d-${i}`,
        at: new Date().toISOString(),
        text: `Implement note ${i}: ${"detail ".repeat(35)}`,
      });
      session.todos.push({
        id: `t-${i}`,
        text: `Task ${i}`,
        status: i % 2 === 0 ? "pending" : "done",
      });
    }

    const { bundle } = buildHandoffArtifacts(session, "codex", sampleGit, {
      tier: "implement",
      maxTokens: 200,
    });

    expect(bundle.git).toBeUndefined();
    expect(bundle.decisions.length).toBeLessThan(25);
    expect(estimateHandoffTokens(JSON.stringify(bundle))).toBeLessThanOrEqual(200);
  });
});
