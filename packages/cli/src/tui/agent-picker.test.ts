import { describe, expect, it } from "vitest";
import type { Registry } from "@relay/schema";
import { formatAgentScanList, scanLocalAgents } from "./agent-picker.js";

const registry: Registry = {
  harnesses: [
    {
      id: "claude-code",
      strengths: [],
      weaknesses: [],
      binaries: ["claude"],
    },
    {
      id: "codex",
      strengths: [],
      weaknesses: [],
      binaries: ["codex"],
    },
    {
      id: "pi",
      strengths: [],
      weaknesses: [],
      binaries: ["pi"],
    },
  ],
};

describe("agent-picker", () => {
  it("marks agents missing from a mocked PATH", async () => {
    const scan = await scanLocalAgents(registry, "/nonexistent-bin-dir");
    expect(scan).toHaveLength(3);
    expect(scan.every((entry) => !entry.installed)).toBe(true);
  });

  it("formats toggle list with enabled markers", () => {
    const scan = [
      {
        id: "pi" as const,
        label: "Pi",
        binaries: ["pi"],
        installed: true,
        installedBinary: "pi",
      },
      {
        id: "codex" as const,
        label: "Codex",
        binaries: ["codex"],
        installed: false,
      },
    ];
    const lines = formatAgentScanList(scan, ["pi"]);
    expect(lines[0]).toContain("[x]");
    expect(lines[0]).toContain("Pi");
    expect(lines[1]).toContain("[ ]");
    expect(lines[1]).toContain("✗");
  });
});
