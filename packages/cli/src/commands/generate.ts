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
    .action(async (options: { optimize?: boolean }) => {
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

      if (options.optimize) {
        const optimizeSpinner = spinner();
        optimizeSpinner.start("Running AI optimization...");
        const result = await optimizeIRWithAI(ir, {
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
        ir,
      };
      await writeFile(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");

      outro("Project regenerated successfully.");
    });
}
