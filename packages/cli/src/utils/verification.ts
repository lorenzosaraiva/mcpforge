import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadConfig,
  writeConfigFile,
  CURRENT_COMPATIBILITY_VERSION,
  type LoadedMCPForgeConfig,
} from "./config.js";
import {
  computeRuntimeHash,
  generationIsCurrent,
  GENERATOR_RUNTIME_VERSION,
} from "./runtime-integrity.js";
import {
  createCompatibilityHarness,
  runCompatibilityTests,
  type CompatibilityHarness,
} from "./compatibility-runner.js";
import { connectToMCPServer, type MCPServerConnection } from "./mcp-client.js";
import {
  runInvocationTests,
  runRegistrationTests,
  type ToolTestResult,
} from "./test-runner.js";

export interface DiagnosticCheck {
  id: string;
  status: "passed" | "failed" | "skipped";
  required: boolean;
  message: string;
  remediation?: string;
}
export interface VerificationOptions {
  dir?: string;
  live?: boolean;
  timeout?: string;
  skipInstall?: boolean;
}
export interface DiagnosticReport {
  schemaVersion: 1;
  mode: "inspection" | "mock" | "live";
  ok: boolean;
  checks: DiagnosticCheck[];
}

export function report(
  checks: DiagnosticCheck[],
  mode: DiagnosticReport["mode"],
): DiagnosticReport {
  return {
    schemaVersion: 1,
    mode,
    ok: !checks.some((check) => check.required && check.status === "failed"),
    checks,
  };
}

function runNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const npmCli = process.env.npm_execpath;
    const direct = npmCli && existsSync(npmCli);
    const command = direct
      ? process.execPath
      : process.platform === "win32"
        ? "cmd.exe"
        : "npm";
    const arguments_ = direct
      ? [npmCli, ...args]
      : process.platform === "win32"
        ? ["/d", "/s", "/c", "npm", ...args]
        : args;
    const child = spawn(command, arguments_, {
      cwd,
      env: process.env,
      windowsHide: true,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Captured output may contain secrets from scripts. Diagnostics deliberately expose only the failed check.
    child.stdout?.resume();
    child.stderr?.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error("Command failed")),
    );
  });
}

export async function runVerification(
  options: VerificationOptions,
  progress?: (check: DiagnosticCheck) => void,
): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const add = (check: DiagnosticCheck) => {
    checks.push(check);
    progress?.(check);
  };
  const dir = resolve(options.dir ?? process.cwd());
  const configPath = join(dir, "mcpforge.config.json");
  const repair = `mcpforge test --dir ${JSON.stringify(dir)}`;
  let config: LoadedMCPForgeConfig | undefined;
  let connection: MCPServerConnection | undefined;
  let harness: CompatibilityHarness | undefined;
  let results: ToolTestResult[] = [];
  let testedRuntimeHash: string | undefined;
  let stage = "config";
  let remediation = `Check mcpforge.config.json in ${dir}.`;
  const pass = (id: string, message: string) =>
    add({ id, status: "passed", required: true, message });
  try {
    const timeout = Number(options.timeout ?? 10_000);
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new Error("Invalid timeout");
    config = await loadConfig(configPath);
    pass("config", "Project configuration is valid.");
    stage = "generation";
    remediation = `Run mcpforge generate from ${dir}, then verify again.`;
    if (!(await generationIsCurrent(dir)))
      throw new Error("Outdated generation");
    pass(stage, "Generated runtime matches this generator's templates.");
    stage = "dependencies";
    remediation = `Run npm install in ${dir}.`;
    if (!options.skipInstall)
      await runNpm(
        ["install", "--prefer-offline", "--no-audit", "--no-fund"],
        dir,
      );
    if (!existsSync(join(dir, "node_modules")))
      throw new Error("Dependencies unavailable");
    pass(
      stage,
      options.skipInstall
        ? "Dependency installation skipped; dependency directory exists."
        : "Dependencies installed.",
    );
    stage = "build";
    remediation = `Run npm run build in ${dir} and inspect the compiler errors locally.`;
    await runNpm(["run", "build"], dir);
    testedRuntimeHash = await computeRuntimeHash(dir);
    pass(stage, "Generated server built successfully.");
    if (!options.live) harness = await createCompatibilityHarness(config.ir);
    stage = "handshake";
    remediation = `Check the generated entrypoint and dependency versions, then run ${repair}.`;
    connection = await connectToMCPServer(
      dir,
      timeout,
      harness
        ? {
            ...harness.env,
            DOTENV_CONFIG_PATH:
              process.platform === "win32" ? "NUL" : "/dev/null",
          }
        : undefined,
    );
    pass(stage, "MCP stdio handshake completed.");
    stage = "schemas";
    remediation = `Regenerate the project and run ${repair}.`;
    const registration = await runRegistrationTests(
      connection.client,
      config.ir.tools,
    );
    if (registration.some((item) => item.status === "fail"))
      throw new Error("Schema mismatch");
    pass(
      stage,
      "Registered tool names and input/output schemas match the project IR.",
    );
    stage = "requests";
    remediation = `Inspect the API contract and generated tools, then run ${repair}.`;
    results = options.live
      ? await runInvocationTests(connection.client, config.ir.tools, {
          live: true,
          timeout,
        })
      : await runCompatibilityTests(connection.client, config.ir.tools, {
          timeout,
          sourceIR: config.sourceIR,
          harness: harness!,
        });
    const failed = results.filter((item) => item.status === "fail").length;
    const skipped = results.filter((item) => item.status === "skipped").length;
    add({
      id: stage,
      required: true,
      status: failed
        ? "failed"
        : skipped === results.length
          ? "skipped"
          : "passed",
      message: `${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed ${options.live ? "live" : "mock request"} checks.`,
      ...(failed ? { remediation } : {}),
    });
    if (results.length === 0 || skipped === results.length)
      add({
        id: "requests.coverage",
        required: true,
        status: "failed",
        message: "No supported tool invocation was verified.",
        remediation,
      });
    for (const item of results.filter(
      (result) => result.status === "skipped",
    )) {
      add({
        id: `requests.skipped.${item.toolName}`,
        required: false,
        status: "skipped",
        message:
          "This tool has an unsupported mock input or workflow mapping; it was not verified.",
      });
    }
    for (const item of results.filter((result) => result.status === "fail")) {
      add({
        id: `requests.failed.${item.toolName}`,
        required: true,
        status: "failed",
        message:
          "This tool failed its invocation or request/response contract check.",
        remediation,
      });
    }
  } catch {
    add({
      id: stage,
      required: true,
      status: "failed",
      message: `The ${stage} check failed.`,
      remediation,
    });
  } finally {
    await connection?.close().catch(() => undefined);
    await harness?.close().catch(() => undefined);
  }
  const outcome = report(checks, options.live ? "live" : "mock");
  if (config) {
    try {
      let runtimeHash: string | undefined;
      try {
        runtimeHash = await computeRuntimeHash(dir);
      } catch {
        /* Failed builds can have no runtime artifacts. */
      }
      if (outcome.ok && runtimeHash !== testedRuntimeHash)
        add({
          id: "runtime.changed",
          required: true,
          status: "failed",
          message:
            "Executable files changed while verification ran; no successful receipt was issued.",
          remediation: "Stop editing generated files and rerun verification.",
        });
      const {
        verificationState: _state,
        expectedFinalIRHash: _hash,
        hasSourceIR: _source,
        hasOptimizedIR: _optimized,
        hasWorkflowIR: _workflow,
        ...persisted
      } = config;
      await writeConfigFile(configPath, {
        ...persisted,
        verification: {
          status: report(checks, outcome.mode).ok ? "passed" : "failed",
          mode: options.live ? "live" : "mock",
          verifiedAt: new Date().toISOString(),
          compatibilityVersion: CURRENT_COMPATIBILITY_VERSION,
          finalIRHash: config.expectedFinalIRHash,
          generatorVersion: GENERATOR_RUNTIME_VERSION,
          runtimeHash,
          toolCount: results.length,
          passedToolCount: results.filter((item) => item.status === "pass")
            .length,
          skippedToolCount: results.filter((item) => item.status === "skipped")
            .length,
          failedToolCount: results.filter((item) => item.status === "fail")
            .length,
        },
      });
    } catch {
      add({
        id: "verification.persist",
        required: true,
        status: "failed",
        message: "Verification metadata could not be saved.",
        remediation: "Check project write permissions and rerun verification.",
      });
    }
  }
  return report(checks, options.live ? "live" : "mock");
}
