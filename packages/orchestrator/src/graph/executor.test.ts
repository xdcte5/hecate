import { describe, expect, it } from "vitest";
import { runVerifierGraph } from "./executor.js";
import type { VerifierSpec } from "../verifiers/types.js";

const shellSpec = (command: string): VerifierSpec => ({ type: "shell", command });

describe("runVerifierGraph", () => {
  it("runs verifier nodes concurrently and synthesizes a passing verdict", async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];

    const pending = runVerifierGraph(
      {
        id: "implement",
        task: "test graph",
        verify: [shellSpec("first"), shellSpec("second")],
      },
      "/tmp",
      {
        runSpec: async (spec) => {
          started.push(spec.type === "shell" ? spec.command : spec.type);
          await new Promise<void>((resolve) => release.push(resolve));
          return {
            verifierId: spec.type,
            status: "PASS",
            ok: true,
            confidence: 0.9,
            evidence: `passed ${started.length}`,
            durationMs: 1,
          };
        },
      },
    );

    await Promise.resolve();
    expect(started).toEqual(["first", "second"]);
    release.forEach((resolve) => resolve());
    const resolved = await pending;

    expect(resolved.verdict.ok).toBe(true);
    expect(resolved.verdict.recommendation).toBe("ACT");
    expect(resolved.nodes.map((node) => node.id)).toEqual(["shell-first", "shell-second"]);
    expect(resolved.nodeResults).toHaveLength(2);
  });

  it("synthesizes BLOCK when any verifier fails", async () => {
    const result = await runVerifierGraph(
      {
        id: "implement",
        task: "test graph",
        verify: [shellSpec("pass"), shellSpec("fail")],
      },
      "/tmp",
      {
        runSpec: async (spec) => ({
          verifierId: spec.type,
          status: spec.type === "shell" && spec.command === "fail" ? "FAIL" : "PASS",
          ok: !(spec.type === "shell" && spec.command === "fail"),
          confidence: 0.95,
          evidence: spec.type === "shell" ? spec.command : spec.type,
          durationMs: 1,
        }),
      },
    );

    expect(result.verdict.ok).toBe(false);
    expect(result.verdict.recommendation).toBe("BLOCK");
    expect(result.verdict.evidence).toBe("fail");
  });

  it("converts verifier exceptions to failed node results", async () => {
    const result = await runVerifierGraph(
      {
        id: "implement",
        task: "test graph",
        verify: [shellSpec("explode")],
      },
      "/tmp",
      {
        runSpec: async () => {
          throw new Error("boom");
        },
      },
    );

    expect(result.verdict.ok).toBe(false);
    expect(result.nodeResults[0]).toMatchObject({
      nodeId: "shell-explode",
      nodeType: "verifier",
      ok: false,
    });
    expect(result.nodeResults[0]?.verifier?.evidence).toContain("boom");
  });

  it("uses semantic node ids for artifact and python verifier specs", async () => {
    const result = await runVerifierGraph(
      {
        id: "implement",
        task: "test graph",
        verify: [
          { type: "artifact", path: "hello.sh" },
          { type: "python", code: "from fib import fib; assert fib(10) == 55" },
        ],
      },
      "/tmp",
      {
        runSpec: async (spec) => ({
          verifierId: spec.type,
          status: "PASS",
          ok: true,
          confidence: 1,
          evidence: "passed",
          durationMs: 1,
        }),
      },
    );

    expect(result.nodes.map((node) => node.id)).toEqual([
      "artifact-hello-sh",
      "python-from-fib-import-fib-assert-fib-10-55",
    ]);
  });
});
