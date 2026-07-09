import { describe, it, expect } from "vitest";
import { emptyRhpV1 } from "@relay/schema";
import { buildHandoffArtifacts } from "./rhp-builder.js";
import { renderHandoffMarkdown } from "./render-handoff.js";

describe("rhp-builder", () => {
  it("builds valid handoff bundle and markdown", () => {
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
      {
        remote: "git@github.com:acme/app.git",
        branch: "main",
        head: "abc123def456",
        dirty_files: ["src/auth.ts"],
      },
    );

    expect(bundle.targetHarness).toBe("cursor");
    expect(bundle.sourceHarness).toBe("claude-code");
    expect(bundle.handoffSeq).toBe(1);
    expect(bundle.git?.dirty_files).toEqual(["src/auth.ts"]);

    const parsed = JSON.parse(handoffJson);
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.rhp_version).toBe("1");

    expect(handoffMarkdown).toContain("# Relay Handoff");
    expect(handoffMarkdown).toContain("oauth-login");
    expect(handoffMarkdown).toContain("Use JWT for auth");
    expect(renderHandoffMarkdown(bundle)).toBe(handoffMarkdown);
  });
});
