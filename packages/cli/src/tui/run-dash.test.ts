import { describe, expect, it, vi } from "vitest";

vi.mock("./chat.js", () => ({
  runChat: vi.fn().mockResolvedValue(undefined),
}));

import { runChat } from "./chat.js";
import { runDash } from "./run-dash.js";

describe("runDash", () => {
  it("prints deprecation notice and redirects to relay chat", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runDash({ cwd: "/tmp/proj" });

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("relay dash is deprecated");
    expect(output).toContain("relay chat");
    expect(runChat).toHaveBeenCalledWith({ cwd: "/tmp/proj" });

    stdoutSpy.mockRestore();
  });
});
