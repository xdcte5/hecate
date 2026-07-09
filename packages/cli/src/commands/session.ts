import { Command } from "commander";
import { SessionStore } from "@relay/session";

export function registerSessionCommands(program: Command, getCwd: () => string): void {
  const session = program.command("session").description("Product session lifecycle");

  session
    .command("start")
    .description("Start a new product session")
    .argument("<goal>", "Session goal / feature name")
    .action(async (goal: string) => {
      const store = new SessionStore({ rootDir: getCwd() });
      const created = await store.start(goal);
      console.log(`Session started: ${created.sessionId}`);
      console.log(`Goal: ${created.goal}`);
      console.log(`Path: .relay/sessions/${created.sessionId}/session.json`);
    });

  session
    .command("list")
    .description("List product sessions")
    .action(async () => {
      const store = new SessionStore({ rootDir: getCwd() });
      const [sessions, active] = await Promise.all([store.list(), store.getActive()]);
      if (sessions.length === 0) {
        console.log("No sessions yet. Run: relay session start <goal>");
        return;
      }
      for (const s of sessions) {
        const mark = active?.sessionId === s.sessionId ? "*" : " ";
        const kin = s.parentId
          ? " (child)"
          : s.childIds?.length
            ? ` (+${s.childIds.length} children)`
            : "";
        console.log(`${mark} ${s.sessionId}  ${s.status.padEnd(9)} ${(s.activeHarness ?? "-").padEnd(11)} ${s.goal}${kin}`);
      }
    });

  session
    .command("resume")
    .description("Make an existing session active")
    .argument("<id>", "Session id")
    .action(async (id: string) => {
      const store = new SessionStore({ rootDir: getCwd() });
      const session = await store.resume(id);
      console.log(`Resumed session: ${session.sessionId}`);
      console.log(`Goal: ${session.goal}`);
    });

  session
    .command("status")
    .description("Show active session")
    .action(async () => {
      const store = new SessionStore({ rootDir: getCwd() });
      const active = await store.getActive();
      if (!active) {
        console.log("No active session. Run: relay session start <goal>");
        return;
      }
      console.log(JSON.stringify(active, null, 2));
    });
}
