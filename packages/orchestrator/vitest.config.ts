import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "../../fixtures/minimal-relay/e2e/**/*.test.ts"],
  },
});
