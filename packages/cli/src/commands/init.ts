import { writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import {
  type MCPForgeIR,
  generateTypeScriptMCPServer,
  inferIRFromDocs,
  optimizeIRWithAI,
  parseOpenAPISpec,
  scrapeDocsFromUrl,
  type ScrapedDocPage,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import { promptConfirm, promptText } from "../utils/prompts.js";

interface MCPForgeConfig {
  specSource: string;
  sourceType: "openapi" | "docs-url";
  apiName: string;
  outputDir: string;
  optimized: boolean;
  optimizerMode: "strict" | "standard";
  maxTools: number;
  ir: MCPForgeIR;
  scrapedDocs?: ScrapedDocPage[];
}

const DEFAULT_STRICT_MAX_TOOLS = 25;
const DEFAULT_STANDARD_MAX_TOOLS = 80;

function isNonInteractiveRuntime(): boolean {
  return process.env.MCPFORGE_NON_INTERACTIVE === "1" || !process.stdin.isTTY || !process.stdout.isTTY;
}

function resolveOptimizationMode(options: {
  strict?: boolean;
  standard?: boolean;
}): "strict" | "standard" {
  if (options.strict && options.standard) {
    throw new Error("Use either --strict or --standard, not both.");
  }
  if (options.standard) {
    return "standard";
  }
  return "strict";
}

function resolveMaxTools(
  rawValue: string | undefined,
  mode: "strict" | "standard",
): number {
  if (rawValue === undefined) {
    return mode === "strict" ? DEFAULT_STRICT_MAX_TOOLS : DEFAULT_STANDARD_MAX_TOOLS;
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`--max-tools must be a positive number. Received: ${rawValue}`);
  }
  return Math.floor(numeric);
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
    .argument("<spec>", "OpenAPI spec URL/path, or docs URL with --from-url")
    .description("Parse an OpenAPI spec (or infer from docs URL) and generate a complete MCP server project")
    .option("--from-url", "Treat <spec> as an API documentation URL and infer endpoints with AI")
    .option("--optimize", "Enable AI optimization")
    .option("--no-optimize", "Disable AI optimization")
    .option("--strict", "Use strict optimization mode (aggressive curation)")
    .option("--standard", "Use standard optimization mode (broader tool coverage)")
    .option("--max-tools <number>", "Set max tools target for optimization mode")
    .option("-o, --output <dir>", "Output directory for generated project")
    .option("--dry-run", "Parse and optimize, then print tool summary without writing files")
    .action(
      async (
        spec: string,
        options: {
          optimize?: boolean;
          output?: string;
          dryRun?: boolean;
          fromUrl?: boolean;
          strict?: boolean;
          standard?: boolean;
          maxTools?: string;
        },
      ) => {
      intro("mcpforge init");

      const optimizerMode = resolveOptimizationMode(options);
      const maxTools = resolveMaxTools(options.maxTools, optimizerMode);

      let parsedIR: MCPForgeIR;
      let sourceType: MCPForgeConfig["sourceType"] = "openapi";
      let scrapedDocs: ScrapedDocPage[] | undefined;

      if (options.fromUrl) {
        sourceType = "docs-url";
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          throw new Error("--from-url requires ANTHROPIC_API_KEY to infer API structure from documentation.");
        }

        const scrapeSpinner = spinner();
        scrapeSpinner.start(`Scraping API documentation from ${spec}...`);
        scrapedDocs = await scrapeDocsFromUrl(spec, {
          logger: (message) => log.warn(message),
          maxPages: 20,
          timeoutMs: 10_000,
        });
        scrapeSpinner.stop("Documentation pages scraped.");

        note(
          [
            `Found ${scrapedDocs.length} documentation page(s).`,
            "Analyzing documentation with AI to infer API structure...",
          ].join("\n"),
          "Docs Extraction",
        );

        const inferSpinner = spinner();
        inferSpinner.start("Analyzing docs with Claude...");
        parsedIR = await inferIRFromDocs(scrapedDocs, {
          apiKey,
          logger: (message) => log.warn(message),
        });
        inferSpinner.stop("AI analysis completed.");

        log.info(
          `Identified ${parsedIR.tools.length} endpoint(s). API: ${parsedIR.apiName}. Auth: ${parsedIR.auth.type}.`,
        );
      } else {
        const parseSpinner = spinner();
        parseSpinner.start("Parsing OpenAPI spec...");
        parsedIR = await parseOpenAPISpec(spec);
        parseSpinner.stop("OpenAPI parsed successfully.");
      }

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
        optimizeSpinner.start(
          `Optimizing in ${optimizerMode} mode (target: \u2264${maxTools} tools)...`,
        );
        const result = await optimizeIRWithAI(parsedIR, {
          mode: optimizerMode,
          maxTools,
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
            `Source type: ${sourceType}`,
            `Raw endpoints: ${parsedIR.rawEndpointCount}`,
            `Tools after curation: ${finalIR.tools.length}`,
            `Optimizer mode: ${optimizerMode} (\u2264${maxTools})`,
            ...(scrapedDocs ? [`Docs pages analyzed: ${scrapedDocs.length}`] : []),
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
        sourceType,
        apiName: toKebabCase(finalIR.apiName),
        outputDir,
        optimized,
        optimizerMode,
        maxTools,
        ir: finalIR,
        ...(scrapedDocs ? { scrapedDocs } : {}),
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
