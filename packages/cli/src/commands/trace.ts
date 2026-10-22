import { Command } from "commander";
import { readEvents, SessionStore } from "@relay/session";
import { gateProFeature } from "../pro-gate.js";
import {
  buildTraceAudit,
  formatTraceHuman,
  formatTraceJson,
} from "./trace-format.js";

export function registerTraceCommands(program: Command, getCwd: () => string): void {
  program
    .command("trace")
    .description("Show session event timeline grouped by routing hops")
    .argument("[session-id]", "Session id (defaults to active session)")
    .option("--json", "Export grouped hop audit as JSON")
    .option("--otel", "Pro: export trace as OpenTelemetry (coming in v0.2)")
    .action(async (sessionId: string | undefined, options: { json?: boolean; otel?: boolean }) => {
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

      const events = await readEvents(cwd, id);
      const audit = buildTraceAudit(id, events);

      if (options.json) {
        console.log(formatTraceJson(audit));
        return;
      }

      console.log(formatTraceHuman(audit));
    });
}
