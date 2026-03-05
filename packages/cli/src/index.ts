#!/usr/bin/env node

import { Command } from "commander";

import { registerDiffCommand } from "./commands/diff.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerTestCommand } from "./commands/test.js";
import { registerUpdateCommand } from "./commands/update.js";

const program = new Command();

program
  .name("mcpforge")
  .description("Generate MCP servers from OpenAPI specs")
  .version("0.1.0");

registerInitCommand(program);
registerGenerateCommand(program);
registerInspectCommand(program);
registerDiffCommand(program);
registerUpdateCommand(program);
registerTestCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  process.stderr.write(`mcpforge failed: ${message}\n`);
  process.exit(1);
});
