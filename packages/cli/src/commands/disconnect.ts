import type { Command } from "commander";
import { resolve } from "node:path";
import {
  resolveClientTarget,
  type ClientOptions,
} from "../utils/client-adapters.js";
import {
  readClientConnections,
  writeConnection,
} from "../utils/connections.js";
import { planClientConfig, applyConfigPlan } from "../utils/connect-config.js";
import { promptConfirm } from "../utils/prompts.js";
import { isNonInteractiveRuntime } from "../utils/runtime.js";

export interface DisconnectOptions extends ClientOptions {
  name: string;
  dir?: string;
  yes?: boolean;
  dryRun?: boolean;
}
export async function disconnectProject(
  options: DisconnectOptions,
): Promise<boolean> {
  const target = resolveClientTarget(options);
  const record = (await readClientConnections(target)).find(
    (item) =>
      item.client === target.client &&
      item.name === options.name &&
      item.path === target.path &&
      (!options.dir || item.serverDir === resolve(options.dir)),
  );
  if (!record)
    throw new Error(
      "No managed connection matches this name and destination. Check --client, --scope, --config and --dir; no client entries were changed.",
    );
  if (
    record.format !== target.format ||
    record.scope !== target.scope ||
    record.serversKey !== target.serversKey
  ) {
    throw new Error(
      `Use the recorded --scope ${record.scope} --format ${record.format} to disconnect this entry.`,
    );
  }
  const plan = await planClientConfig(target, options.name, record.entry, true);
  process.stdout.write(
    `Disconnect ${options.name} from ${target.path}. Generated files and credentials are retained.\n`,
  );
  if (options.dryRun) return true;
  if (!options.yes && isNonInteractiveRuntime())
    throw new Error(
      "Use --dry-run to preview or --yes to disconnect in non-interactive mode.",
    );
  if (
    !options.yes &&
    !(await promptConfirm(
      "Apply this removal and back up the client configuration?",
      false,
    ))
  )
    return false;
  const backup = await applyConfigPlan(plan);
  await writeConnection(record.serverDir, record, true);
  process.stdout.write(
    `Disconnected ${options.name}.${backup ? ` Backup: ${backup}` : " Entry was already absent."}\n`,
  );
  return true;
}
export function registerDisconnectCommand(program: Command): void {
  program
    .command("disconnect")
    .description(
      "Remove a managed client entry while preserving generated files and credentials",
    )
    .requiredOption("--name <name>", "Managed server name")
    .option("--client <client>", "cursor, claude-desktop, or vscode", "cursor")
    .option("--scope <scope>", "project or user")
    .option(
      "--format <format>",
      "VS Code portable or native format",
      "portable",
    )
    .option("--config <path>", "Explicit client configuration path")
    .option("--project-dir <path>", "Target project directory")
    .option(
      "--dir <path>",
      "Require the recorded generated server directory to match",
    )
    .option("--dry-run", "Preview removal without writing")
    .option("-y, --yes", "Apply without a confirmation prompt")
    .action(async (options: DisconnectOptions) => {
      await disconnectProject(options);
    });
}
