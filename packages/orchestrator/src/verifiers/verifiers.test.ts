import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runVerifiers } from "./index.js";
import type { VerifierSpec } from "./types.js";

describe("runVerifiers", () => {
  it("passes artifact, shell, and python verifier specs with evidence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-step-verify-"));
    const script = join(cwd, "hello.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho hello\n", "utf8");
    await chmod(script, 0o755);
    await writeFile(join(cwd, "add.py"), "def add(a, b):\n    return a + b\n", "utf8");

    const specs: VerifierSpec[] = [
      { type: "artifact", path: "hello.sh" },
      { type: "shell", command: "bash hello.sh", expectStdout: "hello\n" },
      { type: "python", code: "from add import add; assert add(2, 3) == 5" },
    ];

    const verdict = await runVerifiers(
      { id: "implement", task: "create hello.sh and add.py", verify: specs },
      cwd,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.recommendation).toBe("ACT");
    expect(verdict.results.map((result) => result.status)).toEqual(["PASS", "PASS", "PASS"]);
    expect(verdict.evidence).toContain("hello.sh exists");
  });

  it("blocks on mismatched shell stdout and writes verify evidence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-step-verify-"));
    await writeFile(join(cwd, "hello.sh"), "echo goodbye\n", "utf8");

    const verdict = await runVerifiers(
      {
        id: "implement",
        task: "create hello.sh",
        verify: [{ type: "shell", command: "bash hello.sh", expectStdout: "hello\n" }],
      },
      cwd,
      { sessionId: "session-1" },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.recommendation).toBe("BLOCK");
    expect(verdict.evidence).toContain("stdout mismatch");

    const verifyLog = await readFile(
      join(cwd, ".relay", "runs", "session-1", "implement", "verify.jsonl"),
      "utf8",
    );
    expect(verifyLog).toContain('"status":"FAIL"');
    expect(verifyLog).toContain("stdout mismatch");
  });
});
