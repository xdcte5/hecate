import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { detectPiAuthProviders } from "./pi-auth.js";

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("detectPiAuthProviders", () => {
  it("reads provider keys from Pi auth.json without inspecting values", async () => {
    const home = join(tmpdir(), `relay-pi-auth-${Date.now()}`);
    dirs.push(home);
    await mkdir(join(home, ".pi/agent"), { recursive: true });
    await writeFile(
      join(home, ".pi/agent/auth.json"),
      JSON.stringify({
        credentials: {
          openai: { type: "oauth", token: "secret" },
          anthropic: { type: "api_key", key: "secret" },
        },
      }),
      "utf8",
    );

    const providers = await detectPiAuthProviders(home);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
  });

  it("includes env API keys", async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      const providers = await detectPiAuthProviders("/nonexistent");
      expect(providers.has("openai")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
