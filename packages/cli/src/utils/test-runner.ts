import { isDeepStrictEqual } from "node:util";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { isWorkflowTool, type ToolDefinition, type ToolParameter } from "../core.js";
import { toJsonSchema, truncateText } from "../../../core/src/utils/schema-utils.js";

const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 10_000;

type CallToolResponse = Awaited<ReturnType<Client["callTool"]>>;
type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export interface ToolTestResult {
  toolName: string;
  phase: "registration" | "invocation";
  status: "pass" | "fail" | "skipped";
  message: string;
  durationMs: number;
}

export interface InvocationTestOptions {
  live: boolean;
  timeout: number;
  getServerStderrOutput?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeType(type: string): string {
  const normalized = type.toLowerCase();
  if (["string", "number", "integer", "boolean", "object", "array", "null"].includes(normalized)) {
    return normalized;
  }

  return "string";
}

function buildExpectedInputSchema(tool: ToolDefinition): Record<string, unknown> {
  if (isWorkflowTool(tool)) {
    return JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of tool.parameters) {
    const schema: Record<string, unknown> = {
      type: normalizeType(parameter.type || "string"),
      description: parameter.description,
    };

    if (parameter.enum && parameter.enum.length > 0) {
      schema.enum = parameter.enum;
    }
    if (parameter.default !== undefined) {
      schema.default = parameter.default;
    }

    properties[parameter.name] = schema;
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (tool.requestBody) {
    properties.body = toJsonSchema(tool.requestBody.schema);
    if (tool.requestBody.required) {
      required.push("body");
    }
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    schema.required = [...new Set(required)];
  }

  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function resolveSchemaType(schema: Record<string, unknown>): string | undefined {
  const { type } = schema;
  if (typeof type === "string") {
    return type === "null" ? "null" : type;
  }

  if (Array.isArray(type)) {
    const firstTypedValue = type.find((value): value is string => typeof value === "string" && value !== "null");
    if (firstTypedValue) {
      return firstTypedValue;
    }
  }

  if (isRecord(schema.properties)) {
    return "object";
  }

  if (schema.items !== undefined) {
    return "array";
  }

  return undefined;
}

function sampleString(fieldName: string | undefined, format: string | undefined): string {
  const normalizedName = fieldName?.toLowerCase() ?? "";
  const normalizedFormat = format?.toLowerCase() ?? "";

  if (normalizedFormat === "email" || normalizedName.includes("email")) {
    return "user@example.com";
  }

  if (normalizedFormat === "uri" || normalizedFormat === "url" || normalizedName.includes("url")) {
    return "https://example.com";
  }

  if (normalizedFormat === "date-time") {
    return "2024-01-01T00:00:00Z";
  }

  if (normalizedFormat === "date" || normalizedName.includes("date")) {
    return "2024-01-01";
  }

  if (normalizedFormat === "uuid") {
    return "00000000-0000-4000-8000-000000000000";
  }

  if (normalizedName === "id" || normalizedName.endsWith("_id") || normalizedName.endsWith("-id")) {
    return "1";
  }

  return "test";
}

function sampleValueFromSchema(schema: unknown, fieldName?: string): unknown {
  if (!isRecord(schema)) {
    return fieldName ? sampleString(fieldName, undefined) : {};
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  if (schema.const !== undefined) {
    return schema.const;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.example !== undefined) {
    return schema.example;
  }

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }

  const compositedSchemas = [schema.oneOf, schema.anyOf]
    .filter(Array.isArray)
    .flat()
    .filter((entry) => entry !== undefined);
  if (compositedSchemas.length > 0) {
    return sampleValueFromSchema(compositedSchemas[0], fieldName);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const part of schema.allOf) {
      const sample = sampleValueFromSchema(part, fieldName);
      if (isRecord(sample)) {
        Object.assign(merged, sample);
      }
    }
    if (Object.keys(merged).length > 0) {
      return merged;
    }
  }

  const schemaType = resolveSchemaType(schema);
  switch (schemaType) {
    case "string":
      return sampleString(fieldName, typeof schema.format === "string" ? schema.format : undefined);
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    case "array": {
      const sampleItem = sampleValueFromSchema(schema.items, fieldName);
      return sampleItem === undefined ? [] : [sampleItem];
    }
    case "object": {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const requiredFields = Array.isArray(schema.required)
        ? schema.required.filter((value): value is string => typeof value === "string")
        : [];

      const result: Record<string, unknown> = {};
      const keys = requiredFields.length > 0 ? requiredFields : [];
      for (const key of keys) {
        result[key] = sampleValueFromSchema(properties[key], key);
      }
      return result;
    }
    case "null":
      return null;
    default:
      return fieldName ? sampleString(fieldName, undefined) : {};
  }
}

function buildLiveInvocationArgs(tool: ToolDefinition): Record<string, unknown> {
  if (isWorkflowTool(tool)) {
    return sampleValueFromSchema(tool.inputSchema, tool.name) as Record<string, unknown>;
  }

  const args: Record<string, unknown> = {};

  for (const parameter of tool.parameters) {
    if (!parameter.required) {
      continue;
    }

    if (parameter.default !== undefined) {
      args[parameter.name] = parameter.default;
      continue;
    }

    if (parameter.enum && parameter.enum.length > 0) {
      args[parameter.name] = parameter.enum[0];
      continue;
    }

    args[parameter.name] = sampleValueFromParameter(parameter);
  }

  if (tool.requestBody?.required) {
    args.body = sampleValueFromSchema(toJsonSchema(tool.requestBody.schema), "body");
  }

  return args;
}

function sampleValueFromParameter(parameter: ToolParameter): unknown {
  switch (normalizeType(parameter.type || "string")) {
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [sampleString(parameter.name, undefined)];
    case "object":
      return {};
    case "null":
      return null;
    default:
      return sampleString(parameter.name, undefined);
  }
}

function getToolResponseText(result: CallToolResponse): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return "";
  }

  return result.content
    .filter(
      (entry): entry is Extract<(typeof result.content)[number], { type: "text"; text: string }> =>
        entry.type === "text" && typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("\n")
    .trim();
}

function extractHttpStatusCode(text: string): number | undefined {
  const apiFailureMatch = text.match(/\((\d{3})[^)]*\)/);
  if (apiFailureMatch?.[1]) {
    const parsed = Number(apiFailureMatch[1]);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractSuccessStatusCode(result: CallToolResponse): number | undefined {
  const responseText = getToolResponseText(result);
  if (!responseText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseText);
    if (isRecord(parsed) && typeof parsed.status === "number") {
      return parsed.status;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildInvocationResult(
  toolName: string,
  status: ToolTestResult["status"],
  message: string,
  durationMs: number,
): ToolTestResult {
  return {
    toolName,
    phase: "invocation",
    status,
    message,
    durationMs,
  };
}

function classifyInvocationResult(
  tool: ToolDefinition,
  result: CallToolResponse,
  live: boolean,
  durationMs: number,
): ToolTestResult {
  const responseText = getToolResponseText(result);
  const condensedText = truncateText(responseText || "No text response.", 160);

  if (!("isError" in result) || result.isError !== true) {
    const statusCode = extractSuccessStatusCode(result);
    const message =
      statusCode !== undefined && statusCode >= 200 && statusCode < 300
        ? live
          ? `live pass (${statusCode})`
          : `pass (${statusCode})`
        : live
          ? "live pass"
          : "pass";
    return buildInvocationResult(tool.name, "pass", message, durationMs);
  }

  const statusCode = extractHttpStatusCode(responseText);
  if (statusCode === 401 || statusCode === 403) {
    return buildInvocationResult(tool.name, "skipped", `auth required (${statusCode})`, durationMs);
  }

  if (live) {
    const message = statusCode !== undefined ? `live error (${statusCode})` : condensedText;
    return buildInvocationResult(tool.name, "fail", message, durationMs);
  }

  const message = statusCode !== undefined ? `structured error (${statusCode})` : condensedText;
  return buildInvocationResult(tool.name, "pass", message, durationMs);
}

function buildInvocationFailureResult(
  tool: ToolDefinition,
  error: unknown,
  durationMs: number,
  getServerStderrOutput: (() => string) | undefined,
): ToolTestResult {
  const baseMessage = getErrorMessage(error);
  const stderr = truncateText(getServerStderrOutput?.() ?? "", 160);
  const detail =
    stderr.length > 0 && !baseMessage.includes(stderr) ? `${baseMessage} | stderr: ${stderr}` : baseMessage;

  return buildInvocationResult(tool.name, "fail", detail, durationMs);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export async function runRegistrationTests(
  client: Client,
  expectedTools: ToolDefinition[],
): Promise<ToolTestResult[]> {
  const startedAt = Date.now();
  const listedTools = await client.listTools(undefined, { timeout: DEFAULT_LIST_TOOLS_TIMEOUT_MS });
  const durationMs = Date.now() - startedAt;

  const actualByName = new Map<string, ListedTool>();
  for (const tool of listedTools.tools) {
    actualByName.set(tool.name, tool);
  }

  const expectedNames = new Set(expectedTools.map((tool) => tool.name));
  const results: ToolTestResult[] = [];

  for (const expectedTool of expectedTools) {
    const actualTool = actualByName.get(expectedTool.name);
    if (!actualTool) {
      results.push({
        toolName: expectedTool.name,
        phase: "registration",
        status: "fail",
        message: "tool not registered",
        durationMs,
      });
      continue;
    }

    const expectedSchema = buildExpectedInputSchema(expectedTool);
    if (!isDeepStrictEqual(actualTool.inputSchema, expectedSchema)) {
      results.push({
        toolName: expectedTool.name,
        phase: "registration",
        status: "fail",
        message: "input schema mismatch",
        durationMs,
      });
      continue;
    }

    if ((actualTool.description ?? "") !== expectedTool.description) {
      results.push({
        toolName: expectedTool.name,
        phase: "registration",
        status: "fail",
        message: "description mismatch",
        durationMs,
      });
      continue;
    }

    results.push({
      toolName: expectedTool.name,
      phase: "registration",
      status: "pass",
      message: "registered",
      durationMs,
    });
  }

  for (const actualTool of listedTools.tools) {
    if (!expectedNames.has(actualTool.name)) {
      results.push({
        toolName: actualTool.name,
        phase: "registration",
        status: "fail",
        message: "unexpected registered tool",
        durationMs,
      });
    }
  }

  return results;
}

export async function runInvocationTests(
  client: Client,
  tools: ToolDefinition[],
  options: InvocationTestOptions,
): Promise<ToolTestResult[]> {
  const results: ToolTestResult[] = [];

  for (const tool of tools) {
    const startedAt = Date.now();

    try {
      const invocationArgs = options.live ? buildLiveInvocationArgs(tool) : {};
      const response = await client.callTool(
        {
          name: tool.name,
          arguments: invocationArgs,
        },
        undefined,
        {
          timeout: options.timeout,
        },
      );

      results.push(
        classifyInvocationResult(tool, response, options.live, Date.now() - startedAt),
      );
    } catch (error) {
      results.push(
        buildInvocationFailureResult(
          tool,
          error,
          Date.now() - startedAt,
          options.getServerStderrOutput,
        ),
      );
    }
  }

  return results;
}
