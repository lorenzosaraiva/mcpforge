import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import type { MCPForgeIR, ScrapedDocPage } from "../core.js";
import { getAllToolSelectionValues } from "./tool-selection.js";

const ConfigSchema = z
  .object({
    specSource: z.string(),
    sourceType: z.enum(["openapi", "docs-url"]).optional(),
    apiName: z.string().optional(),
    outputDir: z.string().optional(),
    optimized: z.boolean().optional(),
    workflowEnabled: z.boolean().optional(),
    optimizerMode: z.enum(["strict", "standard"]).optional(),
    maxTools: z.number().int().positive().optional(),
    selectedTools: z.array(z.string()).optional(),
    registrySlug: z.string().min(1).optional(),
    registryVersion: z.string().min(1).optional(),
    publishedAt: z.string().min(1).optional(),
    sourceIR: z.unknown().optional(),
    optimizedIR: z.unknown().optional(),
    workflowIR: z.unknown().optional(),
    scrapedDocs: z
      .array(
        z.object({
          url: z.string(),
          content: z.string(),
        }),
      )
      .optional(),
    ir: z.unknown(),
  })
  .passthrough();

export interface MCPForgeConfig {
  specSource: string;
  sourceType: "openapi" | "docs-url";
  apiName: string;
  outputDir: string;
  optimized: boolean;
  workflowEnabled: boolean;
  optimizerMode: "strict" | "standard";
  maxTools: number;
  selectedTools: string[];
  registrySlug?: string;
  registryVersion?: string;
  publishedAt?: string;
  ir: MCPForgeIR;
  sourceIR: MCPForgeIR;
  optimizedIR?: MCPForgeIR;
  workflowIR?: MCPForgeIR;
  scrapedDocs?: ScrapedDocPage[];
}

export interface LoadedMCPForgeConfig extends MCPForgeConfig {
  hasSourceIR: boolean;
  hasOptimizedIR: boolean;
  hasWorkflowIR: boolean;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function resolveApiName(configuredApiName: string | undefined, ir: MCPForgeIR): string {
  const candidate = configuredApiName?.trim() || ir.apiName?.trim();
  return candidate ? toKebabCase(candidate) : "generated-api";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveSpecSourceForRuntime(
  specSource: string,
  sourceType: "openapi" | "docs-url",
  outputDir: string,
  configDir: string,
): string {
  if (sourceType === "docs-url" || isHttpUrl(specSource) || isAbsolute(specSource)) {
    return specSource;
  }

  const fromConfigDir = resolve(configDir, specSource);
  if (existsSync(fromConfigDir)) {
    return fromConfigDir;
  }

  if (!outputDir || isAbsolute(outputDir)) {
    return fromConfigDir;
  }

  const initWorkingDirectory = resolve(configDir, relative(outputDir, "."));
  const fromInitWorkingDirectory = resolve(initWorkingDirectory, specSource);
  if (existsSync(fromInitWorkingDirectory)) {
    return fromInitWorkingDirectory;
  }

  return fromInitWorkingDirectory;
}

export async function loadConfig(configPath: string): Promise<LoadedMCPForgeConfig> {
  let parsedJson: unknown;
  try {
    const rawConfig = await readFile(configPath, "utf8");
    parsedJson = JSON.parse(rawConfig.replace(/^\uFEFF/, ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to read mcpforge.config.json: ${message}`);
  }

  let parsedConfig: z.infer<typeof ConfigSchema>;
  try {
    parsedConfig = ConfigSchema.parse(parsedJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Invalid mcpforge.config.json: ${message}`);
  }

  const ir = parsedConfig.ir as MCPForgeIR;
  const configDir = dirname(configPath);
  const sourceType = parsedConfig.sourceType ?? "openapi";
  const outputDir = parsedConfig.outputDir ?? ".";
  const hasSourceIR = parsedConfig.sourceIR !== undefined;
  const hasOptimizedIR = parsedConfig.optimizedIR !== undefined;
  const hasWorkflowIR = parsedConfig.workflowIR !== undefined;
  const sourceIR = (parsedConfig.sourceIR as MCPForgeIR | undefined) ?? ir;
  const optimizedIR =
    (parsedConfig.optimizedIR as MCPForgeIR | undefined) ?? (parsedConfig.optimized ? ir : undefined);
  const workflowIR =
    (parsedConfig.workflowIR as MCPForgeIR | undefined) ??
    (parsedConfig.workflowEnabled ? ir : undefined);
  const selectedTools = parsedConfig.selectedTools ?? getAllToolSelectionValues(ir);

  return {
    specSource: resolveSpecSourceForRuntime(parsedConfig.specSource, sourceType, outputDir, configDir),
    sourceType,
    apiName: resolveApiName(parsedConfig.apiName, ir),
    outputDir,
    optimized: parsedConfig.optimized ?? false,
    workflowEnabled: parsedConfig.workflowEnabled ?? false,
    optimizerMode: parsedConfig.optimizerMode ?? "strict",
    maxTools: parsedConfig.maxTools ?? 25,
    selectedTools,
    registrySlug: parsedConfig.registrySlug,
    registryVersion: parsedConfig.registryVersion,
    publishedAt: parsedConfig.publishedAt,
    ir,
    sourceIR,
    optimizedIR,
    workflowIR,
    scrapedDocs: parsedConfig.scrapedDocs as ScrapedDocPage[] | undefined,
    hasSourceIR,
    hasOptimizedIR,
    hasWorkflowIR,
  };
}

export async function writeConfigFile(configPath: string, config: MCPForgeConfig): Promise<void> {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
