#!/usr/bin/env node

import { Command } from "commander";

import { registerAddCommand } from "./commands/add.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerPublishCommand } from "./commands/publish.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerTestCommand } from "./commands/test.js";
import { registerUpdateCommand } from "./commands/update.js";

const program = new Command();

program
  .name("mcpforge")
  .description("Generate MCP servers from OpenAPI specs")
  .version("1.0.0");

registerInitCommand(program);
registerGenerateCommand(program);
registerInspectCommand(program);
registerDiffCommand(program);
registerUpdateCommand(program);
registerTestCommand(program);
registerAuthCommand(program);
registerPublishCommand(program);
registerAddCommand(program);
registerSearchCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  process.stderr.write(`mcpforge failed: ${message}\n`);
  process.exit(1);
});
