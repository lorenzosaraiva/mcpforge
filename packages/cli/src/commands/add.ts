import { basename, join, resolve } from "node:path";

import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import {
  generateTypeScriptMCPServer,
  optimizeIRWithAI,
  type MCPForgeIR,
  type OptimizerMode,
  type RegistryIndex,
  type RegistryIndexEntry,
} from "../core.js";
import { type MCPForgeConfig, writeConfigFile } from "../utils/config.js";
import { buildCandidateIR, buildFinalIR, getDefaultSelectedTools } from "../utils/planning.js";
import { promptConfirm } from "../utils/prompts.js";
import {
  fetchRegistryEntry,
  fetchRegistryIndex,
  parseSlugSpecifier,
  suggestRegistryEntries,
  type RegistryEntrySnapshot,
} from "../utils/registry.js";
import { isNonInteractiveRuntime } from "../utils/runtime.js";
import { pickToolsFromIR } from "../utils/tool-picker.js";
import { getAllToolSelectionValues, resolveSelectedToolsForIR } from "../utils/tool-selection.js";

export interface AddCommandOptions {
  optimize?: boolean;
  workflows?: boolean;
  pick?: boolean;
}

export interface AddCommandDependencies {
  fetchImpl?: typeof fetch;
  generateServer?: typeof generateTypeScriptMCPServer;
  optimize?: typeof optimizeIRWithAI;
  writeConfig?: typeof writeConfigFile;
  pickTools?: typeof pickToolsFromIR;
  isNonInteractive?: () => boolean;
  logger?: (message: string) => void;
}

export interface LoadedRegistryInstallTarget {
  index: RegistryIndex;
  indexEntry: RegistryIndexEntry;
  entry: RegistryEntrySnapshot;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function getDefaultOutputDir(entry: RegistryEntrySnapshot): string {
  return `./mcp-server-${toKebabCase(entry.slug || entry.ir.apiName)}`;
}

function buildMetadataCard(entry: RegistryEntrySnapshot): string {
  return [
    `Name: ${entry.name}`,
    `Description: ${entry.description}`,
    `Version: ${entry.version}`,
    `Tools: ${entry.toolCount}`,
    `Publisher: @${entry.publisher}`,
    `Published: ${entry.publishedAt}`,
  ].join("\n");
}

function getSourceIR(entry: RegistryEntrySnapshot): MCPForgeIR {
  return entry.sourceIR ?? entry.ir;
}

function getOptimizerMode(entry: RegistryEntrySnapshot): OptimizerMode {
  return entry.optimizerMode ?? "strict";
}

function getMaxTools(entry: RegistryEntrySnapshot): number {
  return entry.maxTools ?? 25;
}

export function findRegistryTarget(
  index: RegistryIndex,
  slugSpecifier: string,
): {
  entry?: RegistryIndexEntry;
  version?: string;
  suggestions: RegistryIndexEntry[];
} {
  const parsed = parseSlugSpecifier(slugSpecifier);
  const entry = index.entries.find((candidate) => candidate.slug === parsed.slug);
  return {
    entry,
    version: parsed.version,
    suggestions: entry ? [] : suggestRegistryEntries(index.entries, parsed.slug),
  };
}

export async function loadRegistryInstallTarget(
  slugSpecifier: string,
  dependencies: Pick<AddCommandDependencies, "fetchImpl"> = {},
): Promise<LoadedRegistryInstallTarget> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const index = await fetchRegistryIndex(fetchImpl);
  const match = findRegistryTarget(index, slugSpecifier);

  if (!match.entry) {
    const suggestionSuffix =
      match.suggestions.length > 0
        ? ` Did you mean: ${match.suggestions.map((candidate) => candidate.slug).join(", ")}?`
        : "";
    throw new Error(`Registry entry "${slugSpecifier}" was not found.${suggestionSuffix}`);
  }

  if (match.version && match.entry.version !== match.version) {
    throw new Error(
      `Registry entry "${match.entry.slug}" is available at version ${match.entry.version}, not ${match.version}.`,
    );
  }

  const entry = await fetchRegistryEntry(match.entry.entryFile, fetchImpl);
  return {
    index,
    indexEntry: match.entry,
    entry,
  };
}

export async function generateFromRegistryEntry(
  entry: RegistryEntrySnapshot,
  outputDir: string | undefined,
  options: AddCommandOptions,
  dependencies: AddCommandDependencies = {},
): Promise<{ outputDir: string; config: MCPForgeConfig; finalIR: MCPForgeIR }> {
  const generateServer = dependencies.generateServer ?? generateTypeScriptMCPServer;
  const optimize = dependencies.optimize ?? optimizeIRWithAI;
  const writeConfig = dependencies.writeConfig ?? writeConfigFile;
  const pickTools = dependencies.pickTools ?? pickToolsFromIR;
  const isNonInteractive = dependencies.isNonInteractive ?? isNonInteractiveRuntime;
  const logger = dependencies.logger ?? (() => {});

  const rawOutputDir = outputDir || getDefaultOutputDir(entry);
  const resolvedOutputDir = resolve(process.cwd(), rawOutputDir);
  const sourceIR = getSourceIR(entry);

  const shouldRerunPipeline = Boolean(options.optimize || options.workflows || options.pick);
  let optimized = entry.optimized;
  let workflowEnabled = entry.workflowEnabled;
  let optimizedIR = entry.optimizedIR;
  let workflowIR = entry.workflowIR;
  let selectedTools =
    entry.selectedTools.length > 0
      ? resolveSelectedToolsForIR(entry.ir, entry.selectedTools)
      : getAllToolSelectionValues(entry.ir);
  let finalIR = entry.ir;

  if (shouldRerunPipeline) {
    optimized = Boolean(options.optimize);
    workflowEnabled = Boolean(options.workflows);
    optimizedIR = undefined;
    workflowIR = undefined;
    selectedTools = resolveSelectedToolsForIR(sourceIR, entry.selectedTools);

    if (options.optimize) {
      const optimizeResult = await optimize(sourceIR, {
        mode: getOptimizerMode(entry),
        maxTools: getMaxTools(entry),
        logger,
      });

      if (optimizeResult.skipped) {
        optimized = false;
      } else {
        optimizedIR = optimizeResult.optimizedIR;
      }
    }

    const candidateIR = buildCandidateIR({
      sourceIR,
      optimizedIR,
      workflowEnabled,
      maxTools: getMaxTools(entry),
    });

    selectedTools =
      entry.selectedTools.length > 0
        ? resolveSelectedToolsForIR(candidateIR, entry.selectedTools)
        : workflowEnabled
          ? getAllToolSelectionValues(candidateIR)
          : getDefaultSelectedTools({
              sourceIR,
              optimizedIR,
              workflowEnabled,
              maxTools: getMaxTools(entry),
            });

    if (options.pick) {
      if (isNonInteractive()) {
        logger("Non-interactive mode detected. Ignoring --pick.");
      } else {
        const pickResult = await pickTools(candidateIR, {
          defaultSelectedTools: selectedTools,
          message: workflowEnabled
            ? "Select workflow and fallback tools to generate"
            : "Select endpoints to generate as tools",
        });
        selectedTools = pickResult.selectedTools;
      }
    }

    finalIR = buildFinalIR({
      sourceIR,
      optimizedIR,
      workflowEnabled,
      maxTools: getMaxTools(entry),
      selectedTools,
    });
    workflowIR = workflowEnabled ? candidateIR : undefined;
  }

  await generateServer(finalIR, {
    outputDir: resolvedOutputDir,
    projectName: basename(resolvedOutputDir),
    sourceIR,
  });

  const config: MCPForgeConfig = {
    specSource: entry.specSource ?? "",
    sourceType: entry.sourceType,
    apiName: entry.slug,
    outputDir: rawOutputDir,
    optimized,
    workflowEnabled,
    optimizerMode: getOptimizerMode(entry),
    maxTools: getMaxTools(entry),
    selectedTools,
    registrySlug: entry.slug,
    registryVersion: entry.version,
    publishedAt: entry.publishedAt,
    ir: finalIR,
    sourceIR,
    ...(optimizedIR ? { optimizedIR } : {}),
    ...(workflowIR ? { workflowIR } : {}),
    ...(entry.scrapedDocs ? { scrapedDocs: entry.scrapedDocs } : {}),
  };

  await writeConfig(join(resolvedOutputDir, "mcpforge.config.json"), config);

  return {
    outputDir: resolvedOutputDir,
    config,
    finalIR,
  };
}

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .argument("<slug>", "Registry slug, optionally suffixed with @version")
    .argument("[outputDir]", "Generated project directory")
    .description("Install a server from the MCPForge registry")
    .option("--optimize", "Re-run AI optimization before generating")
    .option("--workflows", "Re-plan workflow tools before generating")
    .option("--pick", "Interactively customize which tools get generated")
    .action(async (slug: string, outputDir: string | undefined, options: AddCommandOptions) => {
      intro("mcpforge add");

      const resolveSpinner = spinner();
      resolveSpinner.start(`Resolving registry entry "${slug}"...`);
      const target = await loadRegistryInstallTarget(slug);
      resolveSpinner.stop(`Fetched ${target.entry.name} from the registry.`);

      note(buildMetadataCard(target.entry), "Registry Entry");

      const confirmed = await promptConfirm("Generate this MCP server locally?", true);
      if (!confirmed) {
        outro("Add cancelled. No files were written.");
        return;
      }

      const generateSpinner = spinner();
      generateSpinner.start("Generating MCP server from registry entry...");
      const result = await generateFromRegistryEntry(target.entry, outputDir, options, {
        logger: (message) => log.warn(message),
      });
      generateSpinner.stop("Registry entry generated.");

      outro(
        [
          `Installed ${target.entry.slug}@${target.entry.version} in ${result.outputDir}`,
          "",
          "Next steps:",
          `1) cd ${result.outputDir}`,
          "2) npm install",
          "3) npm run build",
        ].join("\n"),
      );
    });
}
