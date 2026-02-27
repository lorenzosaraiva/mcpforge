import { log } from "@clack/prompts";
import type { Command } from "commander";

export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Placeholder command for future MCP server testing")
    .action(() => {
      log.info("Testing coming soon");
    });
}
