import { describe, expect, it } from "vitest";
import { emptyRhpV1 } from "@relay/schema";
import { renderDashboard } from "./render.js";

describe("renderDashboard", () => {
  it("renders bottom handoff bar with active harness", () => {
    const session = emptyRhpV1("abc-123", "add user login page", "cursor");
    session.handoffSeq = 1;

    const output = renderDashboard({
      session,
      hops: [
        {
          at: new Date().toISOString(),
          kind: "handoff",
          from: "cursor",
          to: "codex",
          label: "handoff",
        },
      ],
      projectName: "sample-app",
      width: 80,
      height: 24,
    });

    expect(output).toContain("RELAY");
    expect(output).toContain("add user login page");
    expect(output).toContain("handoff");
    expect(output).toContain("Cursor");
  });

  it("shows empty state without session", () => {
    const output = renderDashboard({
      session: null,
      hops: [],
      projectName: "sample-app",
      width: 80,
      height: 24,
    });

    expect(output).toContain("No active session");
    expect(output).toContain("relay ›");
  });
});
