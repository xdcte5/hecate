import { describe, expect, it } from "vitest";
import { RhpV1Schema, emptyRhpV1, type RhpV1 } from "./rhp-v1.js";

const minimalFixture: RhpV1 = {
  rhp_version: "1",
  sessionId: "sess_01HXYZ",
  goal: "Implement Relay schema package",
  status: "active",
  updated_at: "2026-07-08T09:00:00.000Z",
  activeHarness: "cursor",
  decisions: [
    {
      id: "dec_1",
      at: "2026-07-08T09:05:00.000Z",
      text: "Use Zod for runtime validation",
      rationale: "Matches ide-bridge PCB pattern",
    },
  ],
  todos: [
    { id: "todo_1", text: "Define RhpV1Schema", status: "done" },
    { id: "todo_2", text: "Add vitest fixture", status: "in_progress" },
  ],
  git: {
    remote: "origin",
    branch: "main",
    head: "abc123",
    dirty_files: ["packages/schema/src/rhp-v1.ts"],
  },
  agents: {
    cursor: {
      harness: "cursor",
      lastActiveAt: "2026-07-08T09:00:00.000Z",
      handoffCount: 0,
    },
  },
  handoffSeq: 0,
};

describe("RhpV1Schema", () => {
  it("parses a minimal valid handoff document", () => {
    expect(RhpV1Schema.parse(minimalFixture)).toEqual(minimalFixture);
  });

  it("rejects invalid rhp_version", () => {
    expect(() =>
      RhpV1Schema.parse({ ...minimalFixture, rhp_version: "2" }),
    ).toThrow();
  });

  it("rejects unknown harness ids in agents", () => {
    expect(() =>
      RhpV1Schema.parse({
        ...minimalFixture,
        agents: {
          kiro: {
            harness: "kiro",
            lastActiveAt: "2026-07-08T09:00:00.000Z",
            handoffCount: 0,
          },
        },
      }),
    ).toThrow();
  });

  it("emptyRhpV1 produces a valid document", () => {
    const doc = emptyRhpV1("sess_new", "Ship Sprint 1", "claude-code");
    expect(RhpV1Schema.parse(doc)).toEqual(doc);
    expect(doc.handoffSeq).toBe(0);
    expect(doc.agents["claude-code"]?.harness).toBe("claude-code");
  });
});
