import { writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import {
  type MCPForgeIR,
  generateTypeScriptMCPServer,
  optimizeIRWithAI,
  parseOpenAPISpec,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import { promptConfirm, promptText } from "../utils/prompts.js";

interface MCPForgeConfig {
  specSource: string;
  apiName: string;
  outputDir: string;
  optimized: boolean;
  ir: MCPForgeIR;
}

function isNonInteractiveRuntime(): boolean {
  return process.env.MCPFORGE_NON_INTERACTIVE === "1" || !process.stdin.isTTY || !process.stdout.isTTY;
}

function summarizeTools(ir: MCPForgeIR): string {
  const lines = ir.tools.map(
    (tool, index) =>
      `${index + 1}. ${tool.name}\n   ${tool.method} ${tool.path}\n   ${tool.description}`,
  );
  return lines.join("\n");
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

async function writeConfigFile(configPath: string, config: MCPForgeConfig): Promise<void> {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .argument("<spec>", "OpenAPI spec URL or local file path")
    .description("Parse an OpenAPI spec and generate a complete MCP server project")
    .option("--optimize", "Enable AI optimization")
    .option("--no-optimize", "Disable AI optimization")
    .option("-o, --output <dir>", "Output directory for generated project")
    .option("--dry-run", "Parse and optimize, then print tool summary without writing files")
    .action(async (spec: string, options: { optimize?: boolean; output?: string; dryRun?: boolean }) => {
      intro("mcpforge init");

      const parseSpinner = spinner();
      parseSpinner.start("Parsing OpenAPI spec...");
      const parsedIR = await parseOpenAPISpec(spec);
      parseSpinner.stop("OpenAPI parsed successfully.");

      note(
        [
          `API: ${parsedIR.apiName}`,
          `Endpoints found: ${parsedIR.rawEndpointCount}`,
          `Auth detected: ${parsedIR.auth.type}`,
          `Base URL: ${parsedIR.baseUrl}`,
        ].join("\n"),
        "Spec Summary",
      );

      const wantsOptimization =
        options.optimize ??
        (isNonInteractiveRuntime()
          ? false
          : await promptConfirm("Would you like AI to optimize the tools for LLM usage?", true));

      let finalIR = parsedIR;
      let optimized = false;

      if (wantsOptimization) {
        const optimizeSpinner = spinner();
        optimizeSpinner.start("Optimizing tools with Claude...");
        const result = await optimizeIRWithAI(parsedIR, {
          logger: (message) => log.warn(message),
        });

        if (result.skipped) {
          optimizeSpinner.stop("Optimization skipped.");
          log.warn(result.reason ?? "Optimization skipped.");
        } else {
          optimizeSpinner.stop("Optimization completed.");
          finalIR = result.optimizedIR;
          optimized = true;
          log.info(
            `Tool count changed: ${parsedIR.tools.length} endpoints -> ${finalIR.tools.length} tools`,
          );
        }
      }

      if (options.dryRun) {
        note(
          [
            `Raw endpoints: ${parsedIR.rawEndpointCount}`,
            `Tools after curation: ${finalIR.tools.length}`,
            "",
            summarizeTools(finalIR),
          ].join("\n"),
          "Dry Run Preview",
        );
        outro("Dry run complete. No files were written.");
        return;
      }

      const defaultOutputDir = `./mcp-server-${toKebabCase(parsedIR.apiName)}`;
      const outputDirInput = options.output ?? (await promptText("Output directory", defaultOutputDir));
      const outputDir = outputDirInput || defaultOutputDir;
      const resolvedOutputDir = resolve(process.cwd(), outputDir);

      const generateSpinner = spinner();
      generateSpinner.start(`Generating MCP server in ${outputDir}...`);
      await generateTypeScriptMCPServer(finalIR, {
        outputDir: resolvedOutputDir,
        projectName: basename(resolvedOutputDir),
      });

      const config: MCPForgeConfig = {
        specSource: spec,
        apiName: toKebabCase(finalIR.apiName),
        outputDir,
        optimized,
        ir: finalIR,
      };

      await writeConfigFile(join(resolvedOutputDir, "mcpforge.config.json"), config);
      generateSpinner.stop("Project generated.");

      const displayDir = relative(process.cwd(), resolvedOutputDir) || ".";
      outro(
        [
          `Done. Generated project at ${displayDir}`,
          "",
          "Next steps:",
          `1) cd ${displayDir}`,
          "2) npm install",
          "3) Copy .env.example to .env and fill required values",
          "4) npm run build",
          "5) Add dist/index.js to Claude Desktop MCP config",
        ].join("\n"),
      );
    });
}
