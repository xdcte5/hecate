import { describe, expect, it } from "vitest";
import { formatPlanPanel, formatPlanSummary } from "./plan-panel.js";

const at = "2026-07-14T09:00:00.000Z";

describe("plan-panel", () => {
  it("renders waves with parallel hint", () => {
    const lines = formatPlanPanel({
      type: "plan",
      at,
      steps: [
        { id: "implement-frontend", task: "UI", harness: "pi", wave: 0 },
        { id: "implement-backend", task: "API", harness: "pi", wave: 0 },
        { id: "test", task: "tests", harness: "codex", wave: 1 },
      ],
    });

    expect(lines.some((line) => line.includes("[parallel · 2 agents]"))).toBe(true);
    expect(lines.some((line) => line.includes("Codex") && line.includes("tests"))).toBe(true);
  });

  it("shows status icons and active step marker", () => {
    const lines = formatPlanPanel(
      {
        type: "plan",
        at,
        steps: [{ id: "implement", task: "build login", harness: "pi", wave: 0 }],
      },
      {
        activeStepId: "implement",
        statuses: { implement: "running" },
      },
    );

    expect(lines.some((line) => line.includes("►"))).toBe(true);
    expect(lines.some((line) => line.includes("▶"))).toBe(true);
  });

  it("summarizes parallel waves", () => {
    expect(
      formatPlanSummary({
        type: "plan",
        at,
        steps: [
          { id: "a", task: "a", harness: "pi", wave: 0 },
          { id: "b", task: "b", harness: "cursor", wave: 0 },
          { id: "c", task: "c", harness: "codex", wave: 1 },
        ],
      }),
    ).toBe("3 steps · 2 waves · 1 parallel");
  });
});
