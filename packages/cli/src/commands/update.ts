import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  diffIR,
  generateTypeScriptMCPServer,
  inferIRFromDocs,
  isEndpointTool,
  isWorkflowTool,
  optimizeIRWithAI,
  parseOpenAPISpec,
  scrapeDocsFromUrl,
  type DiffChange,
  type DiffResult,
  type MCPForgeIR,
  type ScrapedDocPage,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import {
  loadConfig,
  type LoadedMCPForgeConfig,
  type MCPForgeConfig,
  writeConfigFile,
} from "../utils/config.js";
import { promptConfirm } from "../utils/prompts.js";
import { isNonInteractiveRuntime } from "../utils/runtime.js";
import { buildCandidateIR, buildFinalIR, getDefaultSelectedTools } from "../utils/planning.js";
import {
  resolveSelectedToolsForIR,
} from "../utils/tool-selection.js";
import { pickToolsFromIR } from "../utils/tool-picker.js";

const DEFAULT_STRICT_MAX_TOOLS = 25;
const DEFAULT_STANDARD_MAX_TOOLS = 80;

const RiskOrder: Record<DiffChange["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveMaxTools(
  configuredMaxTools: number | undefined,
  mode: "strict" | "standard",
): number {
  if (typeof configuredMaxTools === "number" && Number.isFinite(configuredMaxTools) && configuredMaxTools > 0) {
    return Math.floor(configuredMaxTools);
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

function assertOutputDirectoryUsable(outputDir: string): void {
  if (!existsSync(outputDir)) {
    throw new Error(
      `Output directory not found at ${outputDir}. It may have been moved or deleted. Re-run "mcpforge init" to recreate the project.`,
    );
  }

  const hasExpectedFiles = existsSync(join(outputDir, "src")) && existsSync(join(outputDir, "package.json"));
  if (!hasExpectedFiles) {
    throw new Error(
      `Output directory at ${outputDir} is missing expected generated files (src/ and package.json). Re-run "mcpforge init".`,
    );
  }
}

function looksLikeFetchError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("request timed out") ||
    lower.includes("timed out") ||
    lower.includes("network") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("unable to load") ||
    lower.includes("http ")
  );
}

function toSpecSourceError(
  specSource: string,
  sourceType: "openapi" | "docs-url",
  error: unknown,
): Error {
  const message = getErrorMessage(error);
  if (isHttpUrl(specSource) && looksLikeFetchError(message)) {
    return new Error(`Could not fetch spec from ${specSource}. The URL may have changed.`);
  }

  if (sourceType === "docs-url") {
    return new Error(`Failed to re-scrape docs from ${specSource}: ${message}`);
  }

  return new Error(message);
}

function toRiskEmoji(risk: DiffChange["risk"]): string {
  switch (risk) {
    case "high":
      return "\u{1F534}";
    case "medium":
      return "\u{1F7E1}";
    default:
      return "\u{1F7E2}";
  }
}

function colorizeRisk(value: string, risk: DiffChange["risk"]): string {
  const reset = "\u001B[0m";
  const color =
    risk === "high" ? "\u001B[31m" : risk === "medium" ? "\u001B[33m" : "\u001B[32m";
  return `${color}${value}${reset}`;
}

function formatChangeLine(change: DiffChange): string {
  const headline = `${toRiskEmoji(change.risk)} ${change.toolName} - ${change.method} ${change.path} - ${change.details}`;
  const before = change.before !== undefined ? `   before: ${change.before}` : "";
  const after = change.after !== undefined ? `   after: ${change.after}` : "";
  return [headline, before, after].filter(Boolean).join("\n");
}

function sortChanges(changes: DiffChange[]): DiffChange[] {
  return [...changes].sort((a, b) => {
    const riskDelta = RiskOrder[a.risk] - RiskOrder[b.risk];
    if (riskDelta !== 0) {
      return riskDelta;
    }
    const methodDelta = a.method.localeCompare(b.method);
    if (methodDelta !== 0) {
      return methodDelta;
    }
    const pathDelta = a.path.localeCompare(b.path);
    if (pathDelta !== 0) {
      return pathDelta;
    }
    return a.toolName.localeCompare(b.toolName);
  });
}

function printFormattedDiff(result: DiffResult): void {
  note(
    `Found ${result.summary.totalChanges} changes: ${result.summary.high} high risk, ${result.summary.medium} medium, ${result.summary.low} low`,
    "Summary",
  );

  const riskGroups: DiffChange["risk"][] = ["high", "medium", "low"];
  for (const risk of riskGroups) {
    const group = result.changes.filter((change) => change.risk === risk);
    if (group.length === 0) {
      continue;
    }

    const title = colorizeRisk(`${risk.toUpperCase()} (${group.length})`, risk);
    const body = group.map((change) => formatChangeLine(change)).join("\n\n");
    note(body, title);
  }
}

function resolveChangedOperationIds(
  oldIR: MCPForgeIR,
  newIR: MCPForgeIR,
  result: DiffResult,
): Set<string> {
  const changed = new Set<string>();
  const candidates = [...oldIR.tools, ...newIR.tools].filter((tool) => isEndpointTool(tool));

  for (const change of result.changes) {
    for (const tool of candidates) {
      const matchesMethodPath =
        tool.method.toUpperCase() === change.method.toUpperCase() && tool.path === change.path;
      const matchesName = tool.name === change.toolName;
      if (!matchesMethodPath && !matchesName) {
        continue;
      }

      const operationId = tool.originalOperationId ?? tool.name;
      changed.add(operationId);
    }
  }

  return changed;
}

function printWorkflowImpacts(
  currentIR: MCPForgeIR,
  oldSourceIR: MCPForgeIR,
  newSourceIR: MCPForgeIR,
  diffResult: DiffResult,
): void {
  const changedOperationIds = resolveChangedOperationIds(oldSourceIR, newSourceIR, diffResult);
  const impactedWorkflows = currentIR.tools.filter(
    (tool) =>
      isWorkflowTool(tool) &&
      tool.dependsOnOperationIds.some((operationId) => changedOperationIds.has(operationId)),
  );

  if (impactedWorkflows.length === 0) {
    return;
  }

  const lines = impactedWorkflows.map(
    (tool) =>
      `- ${tool.name}: depends on ${tool.dependsOnOperationIds.filter((operationId) => changedOperationIds.has(operationId)).join(", ")}`,
  );
  note(lines.join("\n"), `Workflow Impact (${impactedWorkflows.length})`);
}

async function parseLatestIRFromSource(
  config: LoadedMCPForgeConfig,
  logger: (message: string) => void,
): Promise<{ ir: MCPForgeIR; scrapedDocs?: ScrapedDocPage[] }> {
  try {
    if (config.sourceType === "docs-url") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "This project was generated from docs URL. ANTHROPIC_API_KEY is required to re-scrape and re-infer during update.",
        );
      }

      const scrapedDocs = await scrapeDocsFromUrl(config.specSource, {
        maxPages: 20,
        timeoutMs: 10_000,
        logger,
      });
      const inferred = await inferIRFromDocs(scrapedDocs, {
        apiKey,
        logger,
      });
      return {
        ir: inferred,
        scrapedDocs,
      };
    }

    return {
      ir: await parseOpenAPISpec(config.specSource),
    };
  } catch (error) {
    throw toSpecSourceError(config.specSource, config.sourceType, error);
  }
}

function shouldReoptimize(options: { optimize?: boolean }, config: LoadedMCPForgeConfig): boolean {
  return options.optimize ?? config.optimized;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for upstream spec changes and regenerate your server in place")
    .option("--force", "Skip confirmation even when high-risk changes are detected")
    .option("--optimize", "Re-run optimization during regeneration")
    .option("--no-optimize", "Skip optimization even if this project was previously optimized")
    .option("--pick", "Interactively re-pick which endpoints become tools")
    .option("--workflows", "Generate task-oriented workflow tools")
    .option("--raw-endpoints", "Disable workflow planning and generate raw endpoint tools")
    .option("--dry-run", "Show what would change without regenerating files")
    .action(
      async (
        options: {
          force?: boolean;
          optimize?: boolean;
          dryRun?: boolean;
          pick?: boolean;
          workflows?: boolean;
          rawEndpoints?: boolean;
        },
      ) => {
        if (process.argv.includes("--optimize") && process.argv.includes("--no-optimize")) {
          throw new Error("Use either --optimize or --no-optimize, not both.");
        }
        if (options.workflows && options.rawEndpoints) {
          throw new Error("Use either --workflows or --raw-endpoints, not both.");
        }

        intro("mcpforge update");

        const configDir = process.cwd();
        const configPath = join(configDir, "mcpforge.config.json");
        if (!existsSync(configPath)) {
          throw new Error(
            'mcpforge.config.json not found in current directory. Run this command from your generated MCP project, or run "mcpforge init" first.',
          );
        }

        const configSpinner = spinner();
        configSpinner.start("Loading mcpforge config...");
        const config = await loadConfig(configPath);
        configSpinner.stop("Config loaded.");
        const workflowEnabled = options.workflows ?? (options.rawEndpoints ? false : config.workflowEnabled);

        const outputDir = resolveOutputDirectory(config.outputDir, configDir);
        assertOutputDirectoryUsable(outputDir);

        const refreshSpinner = spinner();
        refreshSpinner.start(
          config.sourceType === "docs-url"
            ? `Re-scraping docs and inferring API from: ${config.specSource}`
            : `Re-parsing spec: ${config.specSource}`,
        );
        const latest = await parseLatestIRFromSource(config, (message) => log.warn(message));
        refreshSpinner.stop(
          config.sourceType === "docs-url" ? "Docs re-analysis completed." : "Spec parsed.",
        );

        const currentSelection = workflowEnabled
          ? config.selectedTools
          : resolveSelectedToolsForIR(config.sourceIR, config.selectedTools);
        const previousSelectedIR = workflowEnabled
          ? config.sourceIR
          : {
              ...config.sourceIR,
              tools: config.sourceIR.tools.filter((tool) =>
                currentSelection.includes(tool.originalOperationId ?? tool.name),
              ),
            };
        const latestSelectedIR = workflowEnabled
          ? latest.ir
          : {
              ...latest.ir,
              tools: latest.ir.tools.filter((tool) =>
                currentSelection.includes(tool.originalOperationId ?? tool.name),
              ),
            };

        const diffSpinner = spinner();
        diffSpinner.start("Comparing previous and current IR...");
        const rawResult = diffIR(previousSelectedIR, latestSelectedIR);
        const result = {
          ...rawResult,
          changes: sortChanges(rawResult.changes),
        };
        diffSpinner.stop("Diff completed.");

        const hasChanges = result.summary.totalChanges > 0;
        const pickerEnabled = Boolean(options.pick) && !isNonInteractiveRuntime();
        if (hasChanges) {
          printFormattedDiff(result);
          if (workflowEnabled) {
            printWorkflowImpacts(config.ir, config.sourceIR, latest.ir, result);
          }
        } else {
          note(
            workflowEnabled
              ? "No upstream changes were detected for the current workflow plan."
              : "No upstream changes were detected for the currently selected tools.",
            "Up To Date",
          );
        }

        if (options.pick && !pickerEnabled) {
          log.warn("Non-interactive mode detected. Ignoring --pick.");
        }

        if (options.dryRun) {
          outro("Dry run complete. No files were written.");
          return;
        }

        if (!hasChanges && !pickerEnabled && !options.optimize) {
          outro("\u2705 Your server is up to date.");
          return;
        }

        const hasHighRiskChanges = result.summary.high > 0;
        if (hasHighRiskChanges && !options.force) {
          if (isNonInteractiveRuntime()) {
            log.warn(
              "\u26A0\uFE0F Breaking changes detected. Non-interactive mode is enabled, so regeneration was skipped. Re-run with --force to continue.",
            );
            outro("Update finished without regeneration.");
            return;
          }

          const confirmed = await promptConfirm(
            "\u26A0\uFE0F Breaking changes detected. Regenerate anyway? (y/n)",
            false,
          );
          if (!confirmed) {
            outro("Update cancelled. No files were written.");
            return;
          }
        }

        const runOptimization = hasChanges
          ? shouldReoptimize({ optimize: options.optimize }, config)
          : Boolean(options.optimize);
        const canReuseStoredOptimization =
          !hasChanges && !runOptimization && config.optimized && config.optimizedIR !== undefined;

        let optimized = canReuseStoredOptimization;
        let optimizedIR = canReuseStoredOptimization ? config.optimizedIR : undefined;

        if (runOptimization) {
          const optimizeSpinner = spinner();
          optimizeSpinner.start(
            `Optimizing in ${config.optimizerMode} mode (target: \u2264${config.maxTools} tools)...`,
          );
          const optimizeResult = await optimizeIRWithAI(latest.ir, {
            mode: config.optimizerMode,
            maxTools: resolveMaxTools(config.maxTools, config.optimizerMode),
            logger: (message) => log.warn(message),
          });

          if (optimizeResult.skipped) {
            optimizeSpinner.stop("Optimization skipped.");
            optimized = false;
            optimizedIR = undefined;
            log.warn(optimizeResult.reason ?? "Optimization skipped.");
          } else {
            optimizeSpinner.stop("Optimization completed.");
            optimizedIR = optimizeResult.optimizedIR;
            optimized = true;
            note(
              `AI suggested ${optimizeResult.optimizedIR.tools.length} tools for the updated spec.`,
              "Optimization Result",
            );
          }
        }

        const candidateIR = buildCandidateIR({
          sourceIR: latest.ir,
          optimizedIR: optimized ? optimizedIR : undefined,
          workflowEnabled,
          maxTools: config.maxTools,
        });
        let selectedTools = resolveSelectedToolsForIR(candidateIR, config.selectedTools);

        if (pickerEnabled) {
          const defaultSelectedTools = workflowEnabled
            ? selectedTools
            : getDefaultSelectedTools({
                sourceIR: latest.ir,
                optimizedIR: optimized ? optimizedIR : undefined,
                workflowEnabled,
                maxTools: config.maxTools,
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

        const finalIR = buildFinalIR({
          sourceIR: latest.ir,
          optimizedIR: optimized ? optimizedIR : undefined,
          workflowEnabled,
          maxTools: config.maxTools,
          selectedTools,
        });

        const generateSpinner = spinner();
        generateSpinner.start(`Regenerating server in ${outputDir}...`);
        await generateTypeScriptMCPServer(finalIR, {
          outputDir,
          projectName: basename(outputDir),
          sourceIR: latest.ir,
        });
        generateSpinner.stop("Regeneration complete.");

        const updatedConfig: MCPForgeConfig = {
          specSource: config.specSource,
          sourceType: config.sourceType,
          apiName: config.apiName,
          outputDir: config.outputDir,
          optimized,
          workflowEnabled,
          optimizerMode: config.optimizerMode,
          maxTools: config.maxTools,
          selectedTools,
          ir: finalIR,
          sourceIR: latest.ir,
          ...(optimized && optimizedIR ? { optimizedIR } : {}),
          ...(workflowEnabled ? { workflowIR: candidateIR } : {}),
          ...(config.sourceType === "docs-url" ? { scrapedDocs: latest.scrapedDocs } : {}),
        };
        await writeConfigFile(configPath, updatedConfig);

        note(
          [
            `Diff summary: ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low risk changes.`,
            `Selected tools: ${finalIR.tools.length}.`,
            `Optimization: ${optimized ? "applied" : "not applied"}.`,
            `Workflow planning: ${workflowEnabled ? "applied" : "not applied"}.`,
          ].join("\n"),
          "Update Summary",
        );

        outro(
          [
            "Server regenerated successfully.",
            "",
            "Rebuild before running:",
            "npm install && npm run build",
          ].join("\n"),
        );
      },
    );
}
