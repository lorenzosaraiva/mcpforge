import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  type MCPForgeIR,
  generateTypeScriptMCPServer,
  optimizeIRWithAI,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { z } from "zod";

const ConfigSchema = z.object({
  specSource: z.string(),
  sourceType: z.enum(["openapi", "docs-url"]).optional(),
  apiName: z.string(),
  outputDir: z.string().default("."),
  optimized: z.boolean().default(false),
  optimizerMode: z.enum(["strict", "standard"]).optional(),
  maxTools: z.number().int().positive().optional(),
  scrapedDocs: z
    .array(
      z.object({
        url: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  ir: z.unknown(),
});

const DEFAULT_STRICT_MAX_TOOLS = 25;
const DEFAULT_STANDARD_MAX_TOOLS = 80;

function resolveOptimizationMode(
  options: { strict?: boolean; standard?: boolean },
  configuredMode?: "strict" | "standard",
): "strict" | "standard" {
  if (options.strict && options.standard) {
    throw new Error("Use either --strict or --standard, not both.");
  }
  if (options.standard) {
    return "standard";
  }
  if (options.strict) {
    return "strict";
  }
  return configuredMode ?? "strict";
}

function resolveMaxTools(
  rawValue: string | undefined,
  mode: "strict" | "standard",
  configuredMaxTools?: number,
): number {
  if (rawValue !== undefined) {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`--max-tools must be a positive number. Received: ${rawValue}`);
    }
    return Math.floor(numeric);
  }

  if (typeof configuredMaxTools === "number" && Number.isFinite(configuredMaxTools) && configuredMaxTools > 0) {
    return configuredMaxTools;
  }

  return mode === "strict" ? DEFAULT_STRICT_MAX_TOOLS : DEFAULT_STANDARD_MAX_TOOLS;
}

function resolveOutputDirectory(configOutputDir: string, configDir: string): string {
  const looksLikeGeneratedProject =
    existsSync(join(configDir, "src")) && existsSync(join(configDir, "package.json"));

  if (looksLikeGeneratedProject) {
    return configDir;
  }

  return resolve(configDir, configOutputDir || ".");
}

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description("Regenerate MCP server from mcpforge.config.json")
    .option("--optimize", "Re-run AI optimization before generating")
    .option("--strict", "Use strict optimization mode (aggressive curation)")
    .option("--standard", "Use standard optimization mode (broader tool coverage)")
    .option("--max-tools <number>", "Set max tools target for optimization mode")
    .action(async (options: { optimize?: boolean; strict?: boolean; standard?: boolean; maxTools?: string }) => {
      intro("mcpforge generate");

      const configDir = process.cwd();
      const configPath = join(configDir, "mcpforge.config.json");

      if (!existsSync(configPath)) {
        throw new Error("mcpforge.config.json not found in current directory.");
      }

      const configSpinner = spinner();
      configSpinner.start("Loading mcpforge config...");
      const rawConfig = await readFile(configPath, "utf8");
      const parsedConfig = ConfigSchema.parse(JSON.parse(rawConfig));
      configSpinner.stop("Config loaded.");

      let ir = parsedConfig.ir as MCPForgeIR;
      let optimized = parsedConfig.optimized;
      const optimizerMode = resolveOptimizationMode(options, parsedConfig.optimizerMode);
      const maxTools = resolveMaxTools(options.maxTools, optimizerMode, parsedConfig.maxTools);

      if (options.optimize) {
        const optimizeSpinner = spinner();
        optimizeSpinner.start(
          `Optimizing in ${optimizerMode} mode (target: \u2264${maxTools} tools)...`,
        );
        const result = await optimizeIRWithAI(ir, {
          mode: optimizerMode,
          maxTools,
          logger: (message) => log.warn(message),
        });

        if (result.skipped) {
          optimizeSpinner.stop("Optimization skipped.");
          log.warn(result.reason ?? "Optimization skipped.");
        } else {
          ir = result.optimizedIR;
          optimized = true;
          optimizeSpinner.stop("Optimization completed.");
          note(`Tool count: ${result.optimizedIR.tools.length}`, "Optimization Result");
        }
      }

      const outputDir = resolveOutputDirectory(parsedConfig.outputDir, configDir);
      const generateSpinner = spinner();
      generateSpinner.start(`Generating server in ${outputDir}...`);
      await generateTypeScriptMCPServer(ir, {
        outputDir,
        projectName: basename(outputDir),
      });
      generateSpinner.stop("Regeneration complete.");

      const updatedConfig = {
        ...parsedConfig,
        optimized,
        optimizerMode,
        maxTools,
        ir,
      };
      await writeFile(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");

      outro("Project regenerated successfully.");
    });
}
