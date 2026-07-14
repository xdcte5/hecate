import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Registry } from "@relay/schema";

const detectInstalledBinaries = vi.hoisted(() => vi.fn());

vi.mock("@relay/adapters", () => ({
  detectInstalledBinaries,
}));

import { resolveHarnessBinary } from "./resolve-binary.js";

const registry: Registry = {
  harnesses: [
    {
      id: "pi",
      strengths: ["implementation"],
      weaknesses: [],
      binaries: ["pi"],
    },
    {
      id: "claude-code",
      strengths: ["architecture"],
      weaknesses: [],
      binaries: ["claude"],
    },
  ],
};

describe("resolveHarnessBinary", () => {
  beforeEach(() => {
    detectInstalledBinaries.mockReset();
  });

  it("returns the first installed binary path for a harness", async () => {
    detectInstalledBinaries.mockResolvedValueOnce(["/Users/me/.nvm/versions/node/v22.23.1/bin/pi"]);

    await expect(resolveHarnessBinary(registry, "pi")).resolves.toBe(
      "/Users/me/.nvm/versions/node/v22.23.1/bin/pi",
    );
    expect(detectInstalledBinaries).toHaveBeenCalledWith(["pi"]);
  });

  it("returns null when no harness binary is installed", async () => {
    detectInstalledBinaries.mockResolvedValueOnce([]);

    await expect(resolveHarnessBinary(registry, "pi")).resolves.toBeNull();
  });

  it("returns null for unknown harness ids", async () => {
    await expect(resolveHarnessBinary(registry, "cursor")).resolves.toBeNull();
    expect(detectInstalledBinaries).not.toHaveBeenCalled();
  });
});
