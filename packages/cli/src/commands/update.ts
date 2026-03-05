import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  diffIR,
  generateTypeScriptMCPServer,
  inferIRFromDocs,
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
import { z } from "zod";

import { promptConfirm } from "../utils/prompts.js";

const ConfigSchema = z.object({
  specSource: z.string(),
  sourceType: z.enum(["openapi", "docs-url"]).optional(),
  apiName: z.string().optional(),
  outputDir: z.string().optional(),
  optimized: z.boolean().optional(),
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

interface LoadedConfig {
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

const RiskOrder: Record<DiffChange["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isNonInteractiveRuntime(): boolean {
  return process.env.MCPFORGE_NON_INTERACTIVE === "1" || !process.stdin.isTTY || !process.stdout.isTTY;
}

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

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function resolveOptimizationMode(configuredMode?: "strict" | "standard"): "strict" | "standard" {
  return configuredMode ?? "strict";
}

function resolveApiName(configuredApiName: string | undefined, ir: unknown): string {
  if (configuredApiName && configuredApiName.trim()) {
    return configuredApiName.trim();
  }

  if (ir && typeof ir === "object" && !Array.isArray(ir)) {
    const candidate = (ir as Record<string, unknown>).apiName;
    if (typeof candidate === "string" && candidate.trim()) {
      return toKebabCase(candidate);
    }
  }

  return "generated-api";
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

async function loadConfig(configPath: string): Promise<LoadedConfig> {
  let parsedJson: unknown;
  try {
    const rawConfig = await readFile(configPath, "utf8");
    parsedJson = JSON.parse(rawConfig.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Failed to read mcpforge.config.json: ${getErrorMessage(error)}`);
  }

  let parsedConfig: z.infer<typeof ConfigSchema>;
  try {
    parsedConfig = ConfigSchema.parse(parsedJson);
  } catch (error) {
    throw new Error(`Invalid mcpforge.config.json: ${getErrorMessage(error)}`);
  }

  const ir = parsedConfig.ir as MCPForgeIR;
  const sourceType = parsedConfig.sourceType ?? "openapi";
  const optimizerMode = resolveOptimizationMode(parsedConfig.optimizerMode);
  const maxTools = resolveMaxTools(parsedConfig.maxTools, optimizerMode);

  return {
    specSource: parsedConfig.specSource,
    sourceType,
    apiName: resolveApiName(parsedConfig.apiName, ir),
    outputDir: parsedConfig.outputDir ?? ".",
    optimized: parsedConfig.optimized ?? false,
    optimizerMode,
    maxTools,
    ir,
    scrapedDocs: parsedConfig.scrapedDocs as ScrapedDocPage[] | undefined,
  };
}

async function parseLatestIRFromSource(
  config: LoadedConfig,
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

function shouldReoptimize(options: { optimize?: boolean }, config: LoadedConfig): boolean {
  return options.optimize ?? config.optimized;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for upstream spec changes and regenerate your server in place")
    .option("--force", "Skip confirmation even when high-risk changes are detected")
    .option("--optimize", "Re-run optimization during regeneration")
    .option("--no-optimize", "Skip optimization even if this project was previously optimized")
    .option("--dry-run", "Show what would change without regenerating files")
    .action(async (options: { force?: boolean; optimize?: boolean; dryRun?: boolean }) => {
      if (process.argv.includes("--optimize") && process.argv.includes("--no-optimize")) {
        throw new Error("Use either --optimize or --no-optimize, not both.");
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

      const diffSpinner = spinner();
      diffSpinner.start("Comparing previous and current IR...");
      const rawResult = diffIR(config.ir, latest.ir);
      const result = {
        ...rawResult,
        changes: sortChanges(rawResult.changes),
      };
      diffSpinner.stop("Diff completed.");

      if (result.summary.totalChanges === 0) {
        outro("\u2705 Your server is up to date.");
        return;
      }

      printFormattedDiff(result);

      if (options.dryRun) {
        outro("Dry run complete. Changes detected, but no files were written.");
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

      let finalIR = latest.ir;
      let optimized = false;
      const runOptimization = shouldReoptimize({ optimize: options.optimize }, config);

      if (runOptimization) {
        const optimizeSpinner = spinner();
        optimizeSpinner.start(
          `Optimizing in ${config.optimizerMode} mode (target: \u2264${config.maxTools} tools)...`,
        );
        const optimizeResult = await optimizeIRWithAI(latest.ir, {
          mode: config.optimizerMode,
          maxTools: config.maxTools,
          logger: (message) => log.warn(message),
        });

        if (optimizeResult.skipped) {
          optimizeSpinner.stop("Optimization skipped.");
          optimized = false;
          log.warn(optimizeResult.reason ?? "Optimization skipped.");
        } else {
          optimizeSpinner.stop("Optimization completed.");
          finalIR = optimizeResult.optimizedIR;
          optimized = true;
          note(
            `Tool count changed: ${latest.ir.tools.length} endpoints -> ${finalIR.tools.length} tools`,
            "Optimization Result",
          );
        }
      }

      const generateSpinner = spinner();
      generateSpinner.start(`Regenerating server in ${outputDir}...`);
      await generateTypeScriptMCPServer(finalIR, {
        outputDir,
        projectName: basename(outputDir),
      });
      generateSpinner.stop("Regeneration complete.");

      const updatedConfig: LoadedConfig = {
        specSource: config.specSource,
        sourceType: config.sourceType,
        apiName: config.apiName,
        outputDir: config.outputDir,
        optimized,
        optimizerMode: config.optimizerMode,
        maxTools: config.maxTools,
        ir: finalIR,
        ...(config.sourceType === "docs-url" ? { scrapedDocs: latest.scrapedDocs } : {}),
      };
      await writeFile(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");

      note(
        [
          `Diff summary: ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low risk changes.`,
          `Tool count: ${config.ir.tools.length} -> ${finalIR.tools.length}.`,
          `Optimization: ${runOptimization ? (optimized ? "applied" : "skipped") : "not run"}.`,
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
    });
}
