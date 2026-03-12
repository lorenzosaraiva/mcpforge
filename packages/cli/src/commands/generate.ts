import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  generateTypeScriptMCPServer,
  optimizeIRWithAI,
  type MCPForgeIR,
  type OptimizerMode,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import { loadConfig, type MCPForgeConfig, writeConfigFile } from "../utils/config.js";
import { isNonInteractiveRuntime } from "../utils/runtime.js";
import { buildCandidateIR, buildFinalIR, getDefaultSelectedTools } from "../utils/planning.js";
import {
  resolveSelectedToolsForIR,
} from "../utils/tool-selection.js";
import { pickToolsFromIR } from "../utils/tool-picker.js";

const DEFAULT_STRICT_MAX_TOOLS = 25;
const DEFAULT_STANDARD_MAX_TOOLS = 80;

function resolveOptimizationMode(
  options: { strict?: boolean; standard?: boolean },
  configuredMode?: OptimizerMode,
): OptimizerMode {
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
  mode: OptimizerMode,
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
    .option("--pick", "Interactively re-pick which endpoints become tools")
    .option("--workflows", "Generate task-oriented workflow tools")
    .option("--raw-endpoints", "Disable workflow planning and generate raw endpoint tools")
    .action(
      async (
        options: {
          optimize?: boolean;
          strict?: boolean;
          standard?: boolean;
          maxTools?: string;
          pick?: boolean;
          workflows?: boolean;
          rawEndpoints?: boolean;
        },
      ) => {
        intro("mcpforge generate");

        const configDir = process.cwd();
        const configPath = join(configDir, "mcpforge.config.json");

        if (!existsSync(configPath)) {
          throw new Error("mcpforge.config.json not found in current directory.");
        }

        const configSpinner = spinner();
        configSpinner.start("Loading mcpforge config...");
        const config = await loadConfig(configPath);
        configSpinner.stop("Config loaded.");

        const optimizerMode = resolveOptimizationMode(options, config.optimizerMode);
        const maxTools = resolveMaxTools(options.maxTools, optimizerMode, config.maxTools);
        if (options.workflows && options.rawEndpoints) {
          throw new Error("Use either --workflows or --raw-endpoints, not both.");
        }
        const workflowEnabled = options.workflows ?? (options.rawEndpoints ? false : config.workflowEnabled);

        let optimized = config.optimized;
        let optimizedIR = config.optimizedIR;
        const sourceIR = config.sourceIR;

        if (options.optimize) {
          const optimizeSpinner = spinner();
          optimizeSpinner.start(
            `Optimizing in ${optimizerMode} mode (target: \u2264${maxTools} tools)...`,
          );
          const result = await optimizeIRWithAI(sourceIR, {
            mode: optimizerMode,
            maxTools,
            logger: (message) => log.warn(message),
          });

          if (result.skipped) {
            optimizeSpinner.stop("Optimization skipped.");
            log.warn(result.reason ?? "Optimization skipped.");
          } else {
            optimizedIR = result.optimizedIR;
            optimized = true;
            optimizeSpinner.stop("Optimization completed.");
            note(`AI suggested ${result.optimizedIR.tools.length} tools.`, "Optimization Result");
          }
        }

        const candidateIR = buildCandidateIR({
          sourceIR,
          optimizedIR: optimized ? optimizedIR : undefined,
          workflowEnabled,
          maxTools,
        });
        let selectedTools = resolveSelectedToolsForIR(candidateIR, config.selectedTools);

        if (options.pick) {
          if (isNonInteractiveRuntime()) {
            log.warn("Non-interactive mode detected. Ignoring --pick.");
          } else {
            if (!config.hasSourceIR) {
              log.warn(
                "This config predates full source IR storage. Re-pick is limited to the currently stored tool list.",
              );
            }

            const defaultSelectedTools =
              workflowEnabled
                ? selectedTools
                : getDefaultSelectedTools({
                    sourceIR,
                    optimizedIR: optimized ? optimizedIR : undefined,
                    workflowEnabled,
                    maxTools,
                  });
            const pickResult = await pickToolsFromIR(candidateIR, {
              defaultSelectedTools,
              message: workflowEnabled
                ? "Select workflow and fallback tools to regenerate"
                : "Select endpoints to regenerate as tools",
            });
            selectedTools = pickResult.selectedTools;
            log.info(
              `Selected ${selectedTools.length} tool(s)${pickResult.mode === "tag" ? " by tag" : ""}.`,
            );
          }
        }

        const finalIR = buildFinalIR({
          sourceIR,
          optimizedIR: optimized ? optimizedIR : undefined,
          workflowEnabled,
          maxTools,
          selectedTools,
        });

        const outputDir = resolveOutputDirectory(config.outputDir, configDir);
        const generateSpinner = spinner();
        generateSpinner.start(`Generating server in ${outputDir}...`);
        await generateTypeScriptMCPServer(finalIR, {
          outputDir,
          projectName: basename(outputDir),
          sourceIR,
        });
        generateSpinner.stop("Regeneration complete.");

        const updatedConfig: MCPForgeConfig = {
          specSource: config.specSource,
          sourceType: config.sourceType,
          apiName: config.apiName,
          outputDir: config.outputDir,
          optimized,
          workflowEnabled,
          optimizerMode,
          maxTools,
          selectedTools,
          ir: finalIR,
          sourceIR,
          ...(optimized && optimizedIR ? { optimizedIR } : {}),
          ...(workflowEnabled ? { workflowIR: candidateIR } : {}),
          ...(config.scrapedDocs ? { scrapedDocs: config.scrapedDocs } : {}),
        };
        await writeConfigFile(configPath, updatedConfig);

        outro("Project regenerated successfully.");
      },
    );
}
