import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, type ParseError } from "jsonc-parser";
import type { Command } from "commander";
import { loadConfig } from "../utils/config.js";
import { readConnections } from "../utils/connections.js";
import { readOptional } from "../utils/connect-config.js";
import { credentialsPresent } from "../utils/project-auth.js";
import { generationIsCurrent } from "../utils/runtime-integrity.js";
import {
  report,
  runVerification,
  type DiagnosticCheck,
  type DiagnosticReport,
} from "../utils/verification.js";
import { renderDiagnostics } from "./test.js";

export interface DoctorOptions {
  dir?: string;
  json?: boolean;
  verify?: boolean;
  skipInstall?: boolean;
  timeout?: string;
}

export async function diagnoseProject(
  options: DoctorOptions,
): Promise<DiagnosticReport> {
  const dir = resolve(options.dir ?? process.cwd());
  const checks: DiagnosticCheck[] = [];
  const add = (
    id: string,
    passed: boolean,
    message: string,
    remediation: string,
    required = true,
  ) =>
    checks.push({
      id,
      status: passed ? ("passed" as const) : ("failed" as const),
      required,
      message,
      ...(!passed ? { remediation } : {}),
    });
  let config;
  try {
    config = await loadConfig(join(dir, "mcpforge.config.json"));
  } catch {
    add(
      "config",
      false,
      "Project configuration is missing or invalid.",
      "Point --dir at a generated project and repair its mcpforge.config.json.",
    );
    return report(checks, "inspection");
  }
  add("config", true, "Project configuration is valid.", "");
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  add(
    "runtime.node",
    major > 22 || (major === 22 && minor >= 19),
    "Node runtime support checked.",
    "Install Node 22.19+ or a newer supported LTS release.",
  );
  add(
    "generation",
    await generationIsCurrent(dir),
    "Generated runtime template identity checked.",
    `Run mcpforge generate from ${JSON.stringify(dir)}.`,
  );
  add(
    "dependencies",
    existsSync(join(dir, "node_modules")),
    "Dependency installation presence checked.",
    `Run npm install in ${JSON.stringify(dir)}.`,
  );
  add(
    "build",
    existsSync(join(dir, "dist", "index.js")),
    "Built entrypoint presence checked; this does not execute it.",
    `Run npm run build in ${JSON.stringify(dir)}.`,
  );
  let environment: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = await readOptional(join(dir, ".env"));
    for (const line of (raw ?? "").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
      );
      if (match) {
        let value = match[2] ?? "";
        if (/^(['"`]).*\1$/.test(value)) value = value.slice(1, -1);
        else value = value.split("#", 1)[0]?.trim() ?? "";
        if (!environment[match[1]!]) environment[match[1]!] = value;
      }
    }
    add(
      "credentials.presence",
      credentialsPresent(config.ir, config.sourceIR, environment),
      "Credential presence checked locally; live authentication was not tested.",
      `Fill the required credentials in ${join(dir, ".env")} using .env.example.`,
    );
  } catch {
    add(
      "credentials.presence",
      false,
      "Credential file could not be inspected safely.",
      "Use a regular readable .env file; values are never included in diagnostics.",
    );
  } finally {
    environment = {};
  }
  if (options.verify) {
    const verification = await runVerification({
      dir,
      skipInstall: options.skipInstall,
      timeout: options.timeout,
    });
    checks.push(
      ...verification.checks.filter(
        (check) =>
          !["config", "generation", "dependencies", "build"].includes(check.id),
      ),
    );
    for (const check of verification.checks.filter((item) =>
      ["generation", "dependencies", "build"].includes(item.id),
    )) {
      const index = checks.findIndex((item) => item.id === check.id);
      if (index >= 0) checks[index] = check;
      else checks.push(check);
    }
    try {
      config = await loadConfig(join(dir, "mcpforge.config.json"));
    } catch {
      add(
        "config.changed",
        false,
        "Project configuration changed while verification ran.",
        "Repair the configuration and rerun doctor.",
      );
      return report(checks, "mock");
    }
  }
  add(
    "verification.freshness",
    config.verificationState === "verified",
    `Stored verification is ${config.verificationState}; IR, templates, source, built code, and dependency lock are checked.`,
    `Run mcpforge doctor --dir ${JSON.stringify(dir)} --verify${options.skipInstall ? " --skip-install" : ""}.`,
  );
  if (!options.verify)
    for (const id of ["handshake", "schemas", "requests"])
      checks.push({
        id,
        required: false,
        status: "skipped",
        message:
          "Inspection mode does not start processes. Use --verify for a local mock check.",
      });
  try {
    const records = await readConnections(dir);
    if (!records.length)
      checks.push({
        id: "client.registration",
        status: "skipped",
        required: false,
        message:
          "No managed client connections recorded. Use mcpforge connect to register this project.",
      });
    for (const record of records) {
      let matches = false;
      try {
        const raw = await readOptional(record.path);
        const errors: ParseError[] = [];
        const value =
          raw === undefined
            ? undefined
            : parse(raw.replace(/^\uFEFF/, ""), errors, {
                allowTrailingComma: true,
              });
        matches =
          errors.length === 0 &&
          isDeepStrictEqual(
            value?.[record.serversKey]?.[record.name],
            record.entry,
          ) &&
          record.serverDir === dir;
      } catch {
        /* Invalid client files are reported without disclosing their contents. */
      }
      add(
        `client.registration.${record.client}.${record.name}`,
        matches,
        "Managed client entry and server location checked; application loading was not tested.",
        `Review the client configuration and run mcpforge connect ${JSON.stringify(dir)} --client ${record.client} --scope ${record.scope} --format ${record.format} --config ${JSON.stringify(record.path)} --name ${record.name} --repair.`,
      );
    }
  } catch {
    add(
      "client.records",
      false,
      "Connection records are invalid.",
      "Restore mcpforge.connections.json from its backup before connecting again.",
    );
  }
  checks.push({
    id: "client.loaded",
    status: "skipped",
    required: false,
    message:
      "Reload the server in your client and confirm tools appear; config-file presence cannot prove application loading.",
  });
  checks.push({
    id: "authentication.live",
    status: "skipped",
    required: false,
    message:
      "No real API credential was validated and no real upstream request was made.",
  });
  return report(checks, options.verify ? "mock" : "inspection");
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Inspect a generated project; optionally build and verify it against a local mock API",
    )
    .option("--dir <path>", "Generated server directory")
    .option(
      "--verify",
      "Install, build, launch, and run local mock verification",
    )
    .option("--skip-install", "With --verify, use installed dependencies")
    .option("--timeout <ms>", "Per-tool timeout for --verify", "10000")
    .option("--json", "Emit one diagnostic JSON object without logs or secrets")
    .action(async (options: DoctorOptions) => {
      if (!options.json)
        process.stdout.write(
          `Doctor mode: ${options.verify ? "local mock verification; may install dependencies, build files, and start processes" : "read-only inspection; no installs, builds, processes, or network requests"}.\n`,
        );
      const result = await diagnoseProject(options);
      if (options.json)
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else renderDiagnostics(result);
      if (!result.ok) process.exitCode = 1;
    });
}
