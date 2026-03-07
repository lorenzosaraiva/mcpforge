import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import { intro, log, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import { type LoadedMCPForgeConfig, loadConfig } from "../utils/config.js";
import { connectToMCPServer, type MCPServerConnection } from "../utils/mcp-client.js";
import {
  runInvocationTests,
  runRegistrationTests,
  type ToolTestResult,
} from "../utils/test-runner.js";

const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

interface TestCommandOptions {
  dir?: string;
  live?: boolean;
  timeout?: string;
}

interface ResolvedServerContext {
  config: LoadedMCPForgeConfig;
  serverDir: string;
}

interface CommandResult {
  durationMs: number;
  stdout: string;
  stderr: string;
}

class CommandExecutionError extends Error {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;

  constructor(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    durationMs: number,
  ) {
    super(`${command} failed with exit code ${exitCode}`);
    this.name = "CommandExecutionError";
    this.command = command;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.durationMs = durationMs;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function resolveOutputDirectory(configOutputDir: string, configDir: string): string {
  const looksLikeGeneratedProject =
    existsSync(join(configDir, "src")) && existsSync(join(configDir, "package.json"));

  if (looksLikeGeneratedProject) {
    return configDir;
  }

  return resolve(configDir, configOutputDir || ".");
}

function assertOutputDirectoryUsable(outputDir: string): void {
  if (!existsSync(outputDir)) {
    throw new Error(
      `Generated server directory not found at ${outputDir}. Re-run "mcpforge generate" or pass --dir <path>.`,
    );
  }

  const hasExpectedFiles = existsSync(join(outputDir, "src")) && existsSync(join(outputDir, "package.json"));
  if (!hasExpectedFiles) {
    throw new Error(
      `Generated server directory at ${outputDir} is missing expected files (src/ and package.json).`,
    );
  }
}

function resolveTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_TOOL_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--timeout must be a positive number. Received: ${rawValue}`);
  }

  return Math.floor(parsed);
}

function resolveNpmCommand(): string {
  return "npm";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs / 1_000)}s`;
}

function formatCapturedOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "No output captured.";
  }

  const lines = trimmed.split(/\r?\n/);
  return lines.slice(-12).join("\n");
}

function formatToolLabel(toolName: string, width: number): string {
  return toolName.padEnd(width, ".");
}

function renderToolResult(result: ToolTestResult, width: number): void {
  const statusLabel =
    result.status === "pass" ? "pass" : result.status === "skipped" ? "skipped" : "fail";
  const suffix = result.message ? ` (${result.message})` : "";
  const line = `${formatToolLabel(result.toolName, width)} ${statusLabel}${suffix}`;

  if (result.status === "fail") {
    log.error(line);
    return;
  }

  log.success(line);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const startedAt = Date.now();
  const spawnCommand = process.platform === "win32" ? "cmd.exe" : command;
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", command, ...args] : args;

  return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolvePromise({
          durationMs,
          stdout,
          stderr,
        });
        return;
      }

      rejectPromise(
        new CommandExecutionError(
          [command, ...args].join(" "),
          code ?? -1,
          stdout,
          stderr,
          durationMs,
        ),
      );
    });
  });
}

async function resolveServerContext(rawDir: string | undefined): Promise<ResolvedServerContext> {
  const cwd = process.cwd();

  if (rawDir) {
    const serverDir = resolve(cwd, rawDir);
    const configPath = join(serverDir, "mcpforge.config.json");
    if (!existsSync(configPath)) {
      throw new Error(
        `mcpforge.config.json not found in ${serverDir}. Point --dir at a generated server directory.`,
      );
    }

    const config = await loadConfig(configPath);
    const resolvedDir = resolveOutputDirectory(config.outputDir, serverDir);
    return {
      config,
      serverDir: resolvedDir,
    };
  }

  const configPath = join(cwd, "mcpforge.config.json");
  if (!existsSync(configPath)) {
    throw new Error(
      'mcpforge.config.json not found in current directory. Run this command from a generated MCP project or pass --dir <path>.',
    );
  }

  const config = await loadConfig(configPath);
  return {
    config,
    serverDir: resolveOutputDirectory(config.outputDir, cwd),
  };
}

function summarizeInvocationResults(results: ToolTestResult[]): string {
  const successful = results.filter((result) => result.status !== "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.length - successful;

  const parts = [`${successful}/${results.length} passed`];
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  return parts.join(", ");
}

export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Test a generated MCP server")
    .option("--dir <path>", "Generated server directory")
    .option("--live", "Run live API calls", false)
    .option("--timeout <ms>", "Per-tool call timeout", `${DEFAULT_TOOL_TIMEOUT_MS}`)
    .action(async (options: TestCommandOptions) => {
      intro("mcpforge test");

      let connection: MCPServerConnection | undefined;

      try {
        const timeout = resolveTimeout(options.timeout);

        const resolveSpinner = spinner();
        resolveSpinner.start("Resolving generated server...");
        const { config, serverDir } = await resolveServerContext(options.dir);
        assertOutputDirectoryUsable(serverDir);
        resolveSpinner.stop(`Testing project at ${serverDir}`);

        log.step("Build check");
        const npmCommand = resolveNpmCommand();

        const installSpinner = spinner();
        installSpinner.start("Running npm install...");
        const installResult = await runCommand(npmCommand, ["install"], serverDir);
        installSpinner.stop(`npm install (${formatDuration(installResult.durationMs)})`);

        const buildSpinner = spinner();
        buildSpinner.start("Running npm run build...");
        const buildResult = await runCommand(npmCommand, ["run", "build"], serverDir);
        buildSpinner.stop(`npm run build (${formatDuration(buildResult.durationMs)})`);

        log.step("Server connection");
        const connectSpinner = spinner();
        connectSpinner.start("Starting MCP server over stdio...");
        connection = await connectToMCPServer(serverDir, timeout);
        connectSpinner.stop("MCP server started on stdio");

        const expectedTools = config.ir.tools;

        log.step(`Tool registration (${expectedTools.length} tools)`);
        const registrationResults = await runRegistrationTests(connection.client, expectedTools);
        const registrationFailures = registrationResults.filter((result) => result.status === "fail");
        if (registrationFailures.length === 0) {
          log.success(`All ${expectedTools.length} tools registered correctly`);
        } else {
          const registrationWidth = Math.max(
            24,
            ...registrationFailures.map((result) => result.toolName.length + 4),
          );
          for (const result of registrationFailures) {
            renderToolResult(result, registrationWidth);
          }
        }

        log.step(options.live ? "Tool live tests" : "Tool smoke tests");
        const invocationResults = await runInvocationTests(connection.client, expectedTools, {
          live: Boolean(options.live),
          timeout,
          getServerStderrOutput: connection.getStderrOutput,
        });

        const invocationWidth = Math.max(
          24,
          ...invocationResults.map((result) => result.toolName.length + 4),
        );
        for (const result of invocationResults) {
          renderToolResult(result, invocationWidth);
        }

        const registrationFailureCount = registrationFailures.length;
        const invocationFailureCount = invocationResults.filter((result) => result.status === "fail").length;
        const summary = summarizeInvocationResults(invocationResults);

        if (registrationFailureCount > 0 || invocationFailureCount > 0) {
          const details = [
            `Results: ${summary}`,
            registrationFailureCount > 0
              ? `${registrationFailureCount} registration check(s) failed`
              : undefined,
          ]
            .filter((value): value is string => Boolean(value))
            .join(", ");
          outro(details);
          process.exitCode = 1;
          return;
        }

        outro(`Results: ${summary}`);
      } catch (error) {
        if (error instanceof CommandExecutionError) {
          const output = formatCapturedOutput(error.stderr || error.stdout);
          log.error(
            `${error.command} failed after ${formatDuration(error.durationMs)} with exit code ${error.exitCode}.\n${output}`,
          );
        } else {
          log.error(getErrorMessage(error));
        }

        outro("Test run failed.");
        process.exitCode = 1;
      } finally {
        await connection?.close();
      }
    });
}
