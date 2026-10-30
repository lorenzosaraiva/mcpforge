import type { Command } from "commander";
import {
  runVerification,
  type VerificationOptions,
  type DiagnosticReport,
} from "../utils/verification.js";

export type TestCommandOptions = VerificationOptions;
export function renderDiagnostics(result: DiagnosticReport): void {
  for (const check of result.checks) {
    process.stdout.write(
      `${check.status.padEnd(7)} ${check.id}: ${check.message}\n`,
    );
    if (check.remediation)
      process.stdout.write(`        ${check.remediation}\n`);
  }
}
export async function verifyGeneratedServer(
  options: TestCommandOptions,
): Promise<boolean> {
  process.stdout.write(
    `Verification mode: ${options.live ? "live API calls" : "local mock API"}; ${options.skipInstall ? "skip install, build and launch" : "install, build and launch"}.\n`,
  );
  const result = await runVerification(options);
  renderDiagnostics(result);
  return result.ok;
}
export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Build and verify a generated MCP server")
    .option("--dir <path>", "Generated server directory")
    .option(
      "--live",
      "Explicitly call the real upstream API, including write operations",
    )
    .option("--timeout <ms>", "Per-tool call timeout", "10000")
    .option("--skip-install", "Use dependencies already installed")
    .option("--json", "Emit a single diagnostic JSON report")
    .action(async (options: VerificationOptions & { json?: boolean }) => {
      if (options.json) {
        const result = await runVerification(options);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
      } else if (!(await verifyGeneratedServer(options))) process.exitCode = 1;
    });
}
