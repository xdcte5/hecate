#!/usr/bin/env node
import { Command } from "commander";
import { registerRegistryCommands } from "./commands/registry.js";
import { registerSessionCommands } from "./commands/session.js";
import { registerHandoffCommands } from "./commands/handoff.js";
import { registerTraceCommands } from "./commands/trace.js";
import { registerDoctorCommands } from "./commands/doctor.js";
import { registerInitCommands } from "./commands/init.js";
import { registerBuildCommands } from "./commands/build.js";
import { registerWatchCommands } from "./commands/watch.js";

const program = new Command();
const getCwd = () => process.cwd();

program
  .name("relay")
  .description("Personal dev agent mesh — session, registry, handoff")
  .version("0.0.1");

registerInitCommands(program, getCwd);
registerBuildCommands(program, getCwd);
registerWatchCommands(program, getCwd);
registerRegistryCommands(program, getCwd);
registerSessionCommands(program, getCwd);
registerHandoffCommands(program, getCwd);
registerTraceCommands(program, getCwd);
registerDoctorCommands(program, getCwd);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
