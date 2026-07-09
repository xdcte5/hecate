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
