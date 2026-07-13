#!/usr/bin/env node
import { Command } from "commander";
import { registerRegistryCommands } from "./commands/registry.js";
import { registerSessionCommands } from "./commands/session.js";
import { registerHandoffCommands } from "./commands/handoff.js";
import { registerTraceCommands } from "./commands/trace.js";
import { registerDoctorCommands } from "./commands/doctor.js";
import { registerDashCommands } from "./commands/dash.js";
import { registerChatCommands } from "./commands/chat.js";
import { registerRunCommands } from "./commands/run.js";
import { runChat } from "./tui/chat.js";
import { registerInitCommands } from "./commands/init.js";
import { registerBuildCommands } from "./commands/build.js";
import { registerWatchCommands } from "./commands/watch.js";
import { registerMcpCommands } from "./commands/mcp.js";
import { registerMigrateCommands } from "./commands/migrate.js";
import { registerHarborExecCommands } from "./commands/harbor-exec.js";
import { registerLoginCommands } from "./commands/login.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerBenchCommands } from "./commands/bench.js";

const program = new Command();
const getCwd = () => process.cwd();

program
  .name("hecate")
  .aliases(["relay"])
  .description("Hecate — personal super-harness: one session across your agent subscriptions")
  .version("0.1.0");

registerLoginCommands(program, getCwd);
registerConfigCommands(program, getCwd);
registerInitCommands(program, getCwd);
registerBuildCommands(program, getCwd);
registerWatchCommands(program, getCwd);
registerMcpCommands(program, getCwd);
registerMigrateCommands(program, getCwd);
registerRegistryCommands(program, getCwd);
registerSessionCommands(program, getCwd);
registerHandoffCommands(program, getCwd);
registerTraceCommands(program, getCwd);
registerDoctorCommands(program, getCwd);
registerDashCommands(program, getCwd);
registerChatCommands(program, getCwd);
registerRunCommands(program, getCwd);
registerHarborExecCommands(program, getCwd);
registerBenchCommands(program, getCwd);

const userArgs = process.argv.slice(2);
const preserveFlags = new Set(["--preserve", "-p"]);
const nonFlagArgs = userArgs.filter((arg) => !preserveFlags.has(arg));
if (nonFlagArgs.length === 0 && process.stdin.isTTY) {
  const preserve = userArgs.some((arg) => preserveFlags.has(arg));
  runChat({ cwd: getCwd(), preserve }).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
