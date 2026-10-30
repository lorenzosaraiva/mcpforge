import { lstat, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { intro, log, note, outro } from "@clack/prompts";
import type { Command } from "commander";

import {
  applyReadOnlyPolicy,
  generateTypeScriptMCPServer,
  optimizeIRWithAI,
  parseOpenAPISpec,
  type MCPForgeIR,
} from "../core.js";
import {
  loadConfig,
  writeConfigFile,
  type MCPForgeConfig,
} from "../utils/config.js";
import {
  applyConfigPlan,
  createCredentialFile,
  planClientConfig,
} from "../utils/connect-config.js";
import {
  createClientEntry,
  resolveClientTarget,
  type ClientOptions,
} from "../utils/client-adapters.js";
import {
  connectionRecord,
  readClientConnections,
  writeConnection,
} from "../utils/connections.js";
import { credentialRequirements } from "../utils/project-auth.js";
export { credentialRequirements } from "../utils/project-auth.js";
import {
  buildCandidateIR,
  getDefaultSelectedTools,
} from "../utils/planning.js";
import { promptConfirm, promptPassword } from "../utils/prompts.js";
import { isNonInteractiveRuntime } from "../utils/runtime.js";
import {
  getAllToolSelectionValues,
  filterIRBySelectedTools,
} from "../utils/tool-selection.js";
import { pickToolsFromIR } from "../utils/tool-picker.js";
import { verifyGeneratedServer } from "./test.js";

export interface ConnectOptions extends ClientOptions {
  readOnly?: boolean;
  repair?: boolean;
  client?: string;
  projectDir?: string;
  output?: string;
  name?: string;
  yes?: boolean;
  dryRun?: boolean;
  skipInstall?: boolean;
  skipCredentials?: boolean;
  optimize?: boolean;
  workflows?: boolean;
  pick?: boolean;
}

export interface ConnectDependencies {
  verify?: typeof verifyGeneratedServer;
  confirm?: typeof promptConfirm;
  password?: typeof promptPassword;
  nonInteractive?: () => boolean;
}

async function statOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function slug(value: string): string {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "api"
  );
}

export function examplePrompt(ir: MCPForgeIR): string {
  const tool =
    ir.tools.find(
      (candidate) =>
        candidate.kind === "endpoint" &&
        candidate.method.toUpperCase() === "GET",
    ) ?? ir.tools[0];
  if (!tool) return "No tools were generated.";
  return `Use ${tool.name} to ${tool.description.replace(/[.\s]+$/, "") || "retrieve the API result"}. Ask me for any required inputs before calling it.`;
}

/** Returns false when the user declines; errors propagate to the CLI's error handler. */
export async function connectProject(
  specOrDirectory: string,
  options: ConnectOptions,
  dependencies: ConnectDependencies = {},
): Promise<boolean> {
  const target = resolveClientTarget(options);
  const nonInteractive = (
    dependencies.nonInteractive ?? isNonInteractiveRuntime
  )();
  if (nonInteractive && !options.yes && !options.dryRun) {
    throw new Error(
      "Use --dry-run to preview or --yes to apply the client configuration in non-interactive mode.",
    );
  }
  if (options.pick && nonInteractive)
    throw new Error("--pick requires an interactive terminal.");
  const projectDir = resolve(options.projectDir ?? process.cwd());
  if (!(await statOptional(projectDir))?.isDirectory())
    throw new Error(`Project directory does not exist: ${projectDir}`);
  const inputPath = resolve(specOrDirectory);
  const existing = (await statOptional(inputPath))?.isDirectory() ?? false;
  let config: MCPForgeConfig;
  let serverDir: string;

  if (existing) {
    if (
      options.output ||
      options.optimize ||
      options.workflows ||
      options.pick
    ) {
      throw new Error(
        "When connecting an existing project, omit --output, --optimize, --workflows and --pick. Use mcpforge generate to change its tools.",
      );
    }
    serverDir = inputPath;
    config = await loadConfig(join(serverDir, "mcpforge.config.json"));
    if (options.readOnly && !config.ir.executionPolicy?.readOnly)
      throw new Error(
        "Run mcpforge generate --read-only from the generated directory before connecting it.",
      );
  } else {
    const sourceIR = await parseOpenAPISpec(specOrDirectory);
    let optimizedIR: MCPForgeIR | undefined;
    if (options.optimize) {
      const result = await optimizeIRWithAI(sourceIR, {
        mode: "strict",
        maxTools: 25,
        logger: (message) => log.warn(message),
      });
      if (result.skipped) log.warn(result.reason ?? "Optimization skipped.");
      else optimizedIR = result.optimizedIR;
    }
    const candidateIR = buildCandidateIR({
      sourceIR,
      optimizedIR,
      workflowEnabled: Boolean(options.workflows),
      maxTools: 25,
    });
    const selectedTools = options.pick
      ? (
          await pickToolsFromIR(candidateIR, {
            defaultSelectedTools: getAllToolSelectionValues(candidateIR),
          })
        ).selectedTools
      : getDefaultSelectedTools({
          sourceIR,
          optimizedIR,
          workflowEnabled: Boolean(options.workflows),
          maxTools: 25,
        });
    let ir = filterIRBySelectedTools(candidateIR, selectedTools);
    if (options.readOnly) ir = applyReadOnlyPolicy(ir, sourceIR);
    serverDir = resolve(
      options.output ?? join(projectDir, `mcp-server-${slug(ir.apiName)}`),
    );
    if (await statOptional(serverDir)) {
      throw new Error(
        `Output already exists: ${serverDir}. To resume, run mcpforge connect "${serverDir}" --client cursor, or choose another --output.`,
      );
    }
    config = {
      specSource: /^https?:\/\//i.test(specOrDirectory)
        ? specOrDirectory
        : inputPath,
      sourceType: "openapi",
      apiName: slug(ir.apiName),
      outputDir: serverDir,
      optimized: Boolean(optimizedIR),
      workflowEnabled: Boolean(options.workflows),
      optimizerMode: "strict",
      maxTools: 25,
      selectedTools: getAllToolSelectionValues(ir),
      ir,
      sourceIR,
      ...(optimizedIR ? { optimizedIR } : {}),
      ...(options.workflows ? { workflowIR: candidateIR } : {}),
    };
  }

  if (config.ir.tools.length === 0)
    throw new Error(
      "No tools are available to connect. Check the spec or tool selection.",
    );
  const name = options.name ?? `mcpforge-${slug(config.apiName)}`;
  const configPath = target.path;
  const existingRecord = (await readClientConnections(target)).find(
    (item) =>
      item.name === name &&
      item.client === target.client &&
      item.path === target.path,
  );
  if (
    existingRecord &&
    (existingRecord.format !== target.format ||
      existingRecord.scope !== target.scope ||
      existingRecord.serversKey !== target.serversKey)
  ) {
    throw new Error(
      "This connection was registered with a different scope or format. Use its original --scope and --format, or disconnect it before changing formats.",
    );
  }
  const entry = createClientEntry(serverDir, target);
  const plan = await planClientConfig(
    target,
    name,
    entry,
    false,
    options.repair ? existingRecord?.entry : undefined,
  );
  const credentials = credentialRequirements(config.ir, config.sourceIR);
  note(
    [
      `Server: ${serverDir}`,
      `${target.client} ${target.scope} configuration (${target.format}): ${configPath}`,
      `Tools: ${config.ir.tools.length}`,
      `Credentials: ${credentials.map((credential) => credential.name).join(", ") || "none"}`,
      "Only the proposed entry is shown below; existing servers will be preserved.",
      JSON.stringify({ [target.serversKey]: { [name]: plan.entry } }, null, 2),
    ].join("\n"),
    "Connection preview",
  );
  if (options.dryRun) {
    outro(
      "Preview complete. No files written, dependencies installed, or servers started.",
    );
    return true;
  }
  const confirmed =
    options.yes ||
    (await (dependencies.confirm ?? promptConfirm)(
      "Generate/build, verify with a local mock API, and apply this client configuration?",
      false,
    ));
  if (!confirmed) {
    outro("Connection cancelled. No files written.");
    return false;
  }

  if (!existing) {
    await mkdir(dirname(serverDir), { recursive: true });
    // Exclusive directory creation prevents accidentally regenerating over somebody else's files.
    await mkdir(serverDir);
    await generateTypeScriptMCPServer(config.ir, {
      outputDir: serverDir,
      projectName: basename(serverDir),
      sourceIR: config.sourceIR,
    });
    await writeConfigFile(join(serverDir, "mcpforge.config.json"), config);
  }

  log.info(
    "Building and checking the MCP handshake, tool discovery, and requests against a local mock API.",
  );
  if (
    !(await (dependencies.verify ?? verifyGeneratedServer)({
      dir: serverDir,
      skipInstall: options.skipInstall,
      live: false,
    }))
  ) {
    throw new Error(
      `Verification failed; client configuration was not changed. Fix the reported error, then run mcpforge connect "${serverDir}" --client ${target.client} again.`,
    );
  }

  const envPath = join(serverDir, ".env");
  const existingEnv = await statOptional(envPath);
  let pendingCredentials = false;
  if (existingEnv && (!existingEnv.isFile() || existingEnv.isSymbolicLink())) {
    throw new Error(
      `Expected a regular credential file at ${envPath}. Client configuration was not changed.`,
    );
  }
  if (existingEnv) {
    // Also ensure an existing credential file is excluded from version control.
    await createCredentialFile(serverDir, {});
    log.info(
      `Using existing ${envPath}; its contents were not read or changed. Live authentication has not been checked.`,
    );
  } else {
    const values: Record<string, string> = {};
    for (const credential of credentials) {
      log.info(
        `${credential.name}: ${credential.description}. Stored only in ${envPath}.`,
      );
      values[credential.name] =
        nonInteractive || options.skipCredentials
          ? ""
          : await (dependencies.password ?? promptPassword)(
              `${credential.name} (leave empty to configure later)`,
            );
      if (!values[credential.name]) pendingCredentials = true;
    }
    const created = await createCredentialFile(serverDir, values);
    if (!created)
      log.info(
        "An .env file appeared during setup; it was preserved. Check its credentials locally.",
      );
  }

  const record = {
    ...connectionRecord(target, name, serverDir, entry),
    registeredAt: existingRecord?.registeredAt ?? new Date().toISOString(),
  };
  await writeConnection(serverDir, record);
  let backup: string | undefined;
  try {
    backup = await applyConfigPlan(plan);
  } catch (error) {
    await writeConnection(
      serverDir,
      existingRecord ?? record,
      !existingRecord,
    ).catch(() => undefined);
    throw error;
  }
  outro(
    [
      `Registered ${name} in ${configPath}. Local mock verification passed.`,
      ...(backup
        ? [`Previous client configuration backed up to ${backup}.`]
        : []),
      ...(pendingCredentials
        ? [
            `Before using the tools, fill in the missing credentials in ${envPath} (see .env.example).`,
          ]
        : []),
      `Open ${target.client}, then enable/reload the server in MCP settings. Run mcpforge doctor --dir ${JSON.stringify(serverDir)} for diagnostics.`,
      "Real API access has not been tested. On 401/403, check the credential values and API permissions.",
      `Try: ${examplePrompt(config.ir)}`,
    ].join("\n"),
  );
  return true;
}

export function registerConnectCommand(program: Command): void {
  program
    .command("connect")
    .argument(
      "<spec-or-directory>",
      "OpenAPI file/URL or an existing generated project",
    )
    .description("Generate, verify, and connect an API to an MCP client")
    .option("--client <client>", "cursor, claude-desktop, or vscode", "cursor")
    .option("--scope <scope>", "project or user (Claude Desktop: user only)")
    .option("--config <path>", "Explicit client configuration path")
    .option(
      "--format <format>",
      "VS Code portable or native format",
      "portable",
    )
    .option(
      "--read-only",
      "Expose and enforce only GET, HEAD, and OPTIONS operations",
    )
    .option(
      "--repair",
      "Replace only an unchanged managed entry, for example after moving a server",
    )
    .option(
      "--project-dir <dir>",
      "Project directory (defaults to current directory)",
    )
    .option("-o, --output <dir>", "New generated server directory")
    .option("--name <name>", "Unique client server name")
    .option("--optimize", "Curate tools with AI before generating")
    .option("--workflows", "Generate task-oriented workflow tools")
    .option("--pick", "Interactively select tools")
    .option(
      "--dry-run",
      "Preview configuration without writing files or starting a server",
    )
    .option("-y, --yes", "Apply the preview without confirmation")
    .option(
      "--skip-install",
      "Skip dependency installation (dependencies must already be available)",
    )
    .option(
      "--skip-credentials",
      "Create empty credential variables for manual setup later",
    )
    .action(async (input: string, options: ConnectOptions) => {
      intro("mcpforge connect");
      await connectProject(input, options);
    });
}
