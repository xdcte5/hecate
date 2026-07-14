import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createDriver } from "./factory.js";
import { MockHarnessDriver } from "./mock.js";

let tmp: string;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("MockHarnessDriver", () => {
  it("emits tool events and writes a marker file", async () => {
    tmp = mkdtempSync(join(tmpdir(), "relay-mock-"));
    const events: Array<{ type: string }> = [];

    const driver = new MockHarnessDriver();
    const result = await driver.run({
      cwd: tmp,
      harness: "pi",
      binary: "relay-mock",
      task: "implement demo",
      handoffPath: join(tmp, "HANDOFF.md"),
      onEvent: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.filesTouched).toContain(".relay-mock-run.txt");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent_start", "tool_start", "tool_end", "agent_end"]),
    );
    expect(readFileSync(join(tmp, ".relay-mock-run.txt"), "utf8")).toContain("implement demo");
  });

  it("is selected by factory when RELAY_MOCK_DRIVER=1", () => {
    const previous = process.env.RELAY_MOCK_DRIVER;
    process.env.RELAY_MOCK_DRIVER = "1";
    try {
      const driver = createDriver("pi", "relay-mock");
      expect(driver.kind).toBe("mock");
    } finally {
      if (previous === undefined) delete process.env.RELAY_MOCK_DRIVER;
      else process.env.RELAY_MOCK_DRIVER = previous;
    }
  });
});
