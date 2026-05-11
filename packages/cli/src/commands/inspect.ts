import SwaggerParser from "@apidevtools/swagger-parser";
import { intro, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { isEndpointTool, parseOpenAPISpec, planWorkflowTools, type AuthConfig, type ToolDefinition } from "../core.js";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function getBodyComplexity(schema: unknown): { propertyCount: number; maxDepth: number } {
  let propertyCount = 0;
  let maxDepth = 0;

  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") {
      maxDepth = Math.max(maxDepth, depth);
      return;
    }
    maxDepth = Math.max(maxDepth, depth);

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)) {
      const properties = record.properties as Record<string, unknown>;
      propertyCount += Object.keys(properties).length;
      for (const child of Object.values(properties)) {
        visit(child, depth + 1);
      }
    }

    if (record.items) {
      visit(record.items, depth + 1);
    }

    for (const key of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(record[key])) {
        for (const child of record[key] as unknown[]) {
          visit(child, depth + 1);
        }
      }
    }
  };

  visit(schema, 1);
  return { propertyCount, maxDepth };
}

async function detectApiVersion(specSource: string): Promise<string> {
  try {
    const parser = new SwaggerParser();
    const parsed = (await parser.parse(specSource)) as Record<string, unknown>;
    const info = asRecord(parsed.info);
    if (typeof info.version === "string" && info.version.trim()) {
      return info.version.trim();
    }
  } catch {
    // Ignore version parse errors and fall back to unknown.
  }
  return "unknown";
}

function buildTagSummary(tools: ToolDefinition[]): string {
  const grouped = new Map<string, ToolDefinition[]>();

  for (const tool of tools) {
    const tags = tool.tags.length > 0 ? tool.tags : ["untagged"];
    for (const tag of tags) {
      const current = grouped.get(tag) ?? [];
      current.push(tool);
      grouped.set(tag, current);
    }
  }

  const lines: string[] = [];
  for (const tag of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const groupTools = grouped.get(tag) ?? [];
    lines.push(`${tag} (${groupTools.length})`);
    for (const tool of groupTools) {
      lines.push(
        isEndpointTool(tool)
          ? `  - ${tool.method} ${tool.path} (${tool.name})`
          : `  - WORKFLOW ${tool.name}`,
      );
    }
  }

  return lines.join("\n");
}

function buildWarnings(tools: ToolDefinition[], auth: AuthConfig): string[] {
  const warnings: string[] = [];
  const endpointTools = tools.filter((tool) => isEndpointTool(tool));

  const missingDescriptions = endpointTools.filter(
    (tool) => tool.description.trim().toUpperCase() === `${tool.method.toUpperCase()} ${tool.path}`.toUpperCase(),
  );
  if (missingDescriptions.length > 0) {
    warnings.push(
      `${missingDescriptions.length} endpoint(s) are missing meaningful descriptions.`,
    );
  }

  const missingOperationIds = endpointTools.filter((tool) => !tool.originalOperationId);
  if (missingOperationIds.length > 0) {
    warnings.push(`${missingOperationIds.length} endpoint(s) are missing operationId.`);
  }

  const tooManyParams = endpointTools.filter((tool) => tool.parameters.length >= 20);
  if (tooManyParams.length > 0) {
    warnings.push(
      `${tooManyParams.length} tool(s) have 20+ parameters and are likely too complex for LLMs.`,
    );
  }

  const complexSchemas = endpointTools.filter((tool) => {
    if (!tool.requestBody) {
      return false;
    }
    const complexity = getBodyComplexity(tool.requestBody.schema);
    return complexity.propertyCount >= 30 || complexity.maxDepth >= 7;
  });
  if (complexSchemas.length > 0) {
    warnings.push(
      `${complexSchemas.length} endpoint(s) have overly complex request schemas (high depth/property count).`,
    );
  }

  if (auth.type === "oauth2") {
    const supportedFlows = auth.oauthFlows?.filter((flow) => flow.supported) ?? [];
    if (supportedFlows.length === 0 && !auth.tokenUrl) {
      warnings.push(
        "OAuth was detected, but no supported token flow metadata was found. Generated servers can still use ACCESS_TOKEN or OAUTH_TOKEN_URL overrides.",
      );
    }
    const unsupportedFlows = auth.oauthFlows?.filter((flow) => !flow.supported).map((flow) => flow.type) ?? [];
    if (unsupportedFlows.length > 0) {
      warnings.push(
        `OAuth flow(s) not generated directly: ${[...new Set(unsupportedFlows)].join(", ")}. Use a refresh token, client credentials, or ACCESS_TOKEN.`,
      );
    }
  }

  return warnings;
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .argument("<spec>", "OpenAPI spec URL or local file path")
    .description("Inspect a spec and print API summary, endpoint groups, and quality warnings")
    .option("--workflows", "Preview the task-oriented workflow plan for this API")
    .action(async (spec: string, options: { workflows?: boolean }) => {
      intro("mcpforge inspect");

      const parseSpinner = spinner();
      parseSpinner.start("Parsing OpenAPI spec...");
      const [ir, apiVersion] = await Promise.all([parseOpenAPISpec(spec), detectApiVersion(spec)]);
      parseSpinner.stop("Spec parsed.");

      note(
        [
          `API: ${ir.apiName}`,
          `Version: ${apiVersion}`,
          `Base URL: ${ir.baseUrl}`,
          `Auth: ${ir.auth.type}`,
          `Total endpoints: ${ir.rawEndpointCount}`,
        ].join("\n"),
        "API Summary",
      );

      note(buildTagSummary(ir.tools), "Endpoints by Tag");

      const warnings = buildWarnings(ir.tools, ir.auth);
      if (warnings.length > 0) {
        note(warnings.map((warning) => `- ${warning}`).join("\n"), "Warnings");
      } else {
        note("No major warnings detected.", "Warnings");
      }

      if (options.workflows) {
        const plannedIR = planWorkflowTools(ir);
        const lines = plannedIR.tools.map((tool) =>
          isEndpointTool(tool)
            ? `- [ENDPOINT] ${tool.name}: ${tool.method} ${tool.path}`
            : `- [WORKFLOW] ${tool.name}: depends on ${tool.dependsOnOperationIds.join(", ")}`,
        );
        note(
          [
            `Planned public tools: ${plannedIR.tools.length}`,
            `Workflow tools: ${plannedIR.tools.filter((tool) => tool.kind === "workflow").length}`,
            "",
            ...lines,
          ].join("\n"),
          "Workflow Plan",
        );
      }

      outro("Inspection complete.");
    });
}
