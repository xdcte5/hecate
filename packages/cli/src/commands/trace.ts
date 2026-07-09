import { Command } from "commander";
import { readEvents, SessionStore } from "@relay/session";
import { gateProFeature } from "../pro-gate.js";

function formatKeyFields(event: Record<string, unknown>): string {
  const skip = new Set(["at", "event"]);
  return Object.entries(event)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${rendered}`;
    })
    .join(" ");
}

export function registerTraceCommands(program: Command, getCwd: () => string): void {
  program
    .command("trace")
    .description("Show session event timeline")
    .argument("[session-id]", "Session id (defaults to active session)")
    .option("--otel", "Pro: export trace as OpenTelemetry (coming in v0.2)")
    .option("--children", "Also print each fanned-out child sub-session's timeline")
    .action(async (sessionId: string | undefined, options: { otel?: boolean; children?: boolean }) => {
      gateProFeature("OTel trace export (--otel)", Boolean(options.otel));
      const cwd = getCwd();
      const store = new SessionStore({ rootDir: cwd });

      let id = sessionId;
      if (!id) {
        const active = await store.getActive();
        if (!active) {
          throw new Error("No active session. Run: relay session start <goal>");
        }
        id = active.sessionId;
      }

      const session = await store.get(id);
      const events = await readEvents(cwd, id);
      console.log(`Session: ${id}`);
      if (session?.parentId) console.log(`Parent:  ${session.parentId}`);
      const childIds = session?.childIds ?? [];
      if (childIds.length) console.log(`Children: ${childIds.length}`);
      console.log(`Events: ${events.length}`);
      console.log("");

      for (const event of events) {
        const at = typeof event.at === "string" ? event.at : "?";
        const type = typeof event.event === "string" ? event.event : "?";
        const fields = formatKeyFields(event);
        console.log(`${at}  ${type}${fields ? `  ${fields}` : ""}`);
      }

      if (options.children && childIds.length) {
        for (const childId of childIds) {
          const child = await store.get(childId);
          const childEvents = await readEvents(cwd, childId);
          console.log("");
          console.log(`└─ child ${childId} [${child?.activeHarness ?? "?"}] — ${child?.goal ?? ""}`);
          for (const event of childEvents) {
            const at = typeof event.at === "string" ? event.at : "?";
            const type = typeof event.event === "string" ? event.event : "?";
            const fields = formatKeyFields(event);
            console.log(`   ${at}  ${type}${fields ? `  ${fields}` : ""}`);
          }
        }
      }
    });
}
