import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { captureGitSnapshot } from "./git-snapshot.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("captureGitSnapshot", () => {
  it("includes untracked files in dirty_files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-git-snapshot-"));
    await git(cwd, ["init"]);
    await git(cwd, ["config", "user.email", "relay-test@example.invalid"]);
    await git(cwd, ["config", "user.name", "Relay Test"]);
    await writeFile(join(cwd, "tracked.txt"), "tracked\n", "utf8");
    await git(cwd, ["add", "tracked.txt"]);
    await git(cwd, ["commit", "-m", "initial"]);

    await writeFile(join(cwd, "created-by-agent.ts"), "export const ok = true;\n", "utf8");

    const snapshot = await captureGitSnapshot(cwd);

    expect(snapshot?.dirty_files).toContain("created-by-agent.ts");
  });
});
