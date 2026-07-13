import { describe, expect, it } from "vitest";
import { parsePlanJson, generateLlmPlan, buildPlanningPrompt } from "./llm-planner.js";

describe("parsePlanJson", () => {
  it("parses a clean plan object", () => {
    const tasks = parsePlanJson(
      '{"steps":[{"task":"build the UI","requiredCapabilities":["frontend"],"wave":0}]}',
    );
    expect(tasks).toEqual([
      { id: "step-1", task: "build the UI", requiredCapabilities: ["frontend"], wave: 0 },
    ]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const text = 'Here is the plan:\n```json\n{"steps":[{"task":"add API","wave":1}]}\n```\nDone.';
    const tasks = parsePlanJson(text);
    expect(tasks).toHaveLength(1);
    expect(tasks![0]).toMatchObject({ task: "add API", wave: 1, requiredCapabilities: [] });
  });

  it("assigns sequential ids and drops blank capabilities", () => {
    const tasks = parsePlanJson(
      '{"steps":[{"task":"a","requiredCapabilities":["backend",""]},{"task":"b"}]}',
    );
    expect(tasks!.map((t) => t.id)).toEqual(["step-1", "step-2"]);
    expect(tasks![0]!.requiredCapabilities).toEqual(["backend"]);
  });

  it("rejects malformed or empty plans", () => {
    expect(parsePlanJson("not json at all")).toBeNull();
    expect(parsePlanJson('{"steps":[]}')).toBeNull();
    expect(parsePlanJson('{"steps":[{"nope":1}]}')).toBeNull();
    expect(parsePlanJson('{"other":true}')).toBeNull();
  });
});

describe("generateLlmPlan", () => {
  it("returns null with no planner", async () => {
    expect(await generateLlmPlan("build a thing")).toBeNull();
  });

  it("returns null when the planner output is unparseable", async () => {
    expect(await generateLlmPlan("build a thing", async () => "sorry, no")).toBeNull();
  });

  it("returns null when the planner throws", async () => {
    expect(
      await generateLlmPlan("build a thing", async () => {
        throw new Error("boom");
      }),
    ).toBeNull();
  });

  it("parses a planner's JSON response", async () => {
    const tasks = await generateLlmPlan("build a thing", async (prompt) => {
      expect(prompt).toContain("Goal: build a thing");
      return '{"steps":[{"task":"scaffold","requiredCapabilities":["implementation"],"wave":0}]}';
    });
    expect(tasks).toEqual([
      { id: "step-1", task: "scaffold", requiredCapabilities: ["implementation"], wave: 0 },
    ]);
  });

  it("planning prompt lists the capability vocabulary", () => {
    const prompt = buildPlanningPrompt("goal");
    expect(prompt).toContain("native-tool-loop");
    expect(prompt).toContain("frontend");
  });
});
