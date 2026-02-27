import SwaggerParser from "@apidevtools/swagger-parser";

import type {
  AuthConfig,
  MCPForgeIR,
  RequestBodyDef,
  ToolDefinition,
  ToolParameter,
} from "./types.js";
import { inferSchemaType, toJsonSchema, toSnakeCase, truncateText } from "../utils/schema-utils.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

type OpenAPIDocument = Record<string, unknown>;
type OpenAPIPathItem = Record<string, unknown>;
type OpenAPIOperation = Record<string, unknown>;
type OpenAPIParameter = Record<string, unknown>;
type OpenAPIRequestBody = Record<string, unknown>;

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item): item is string => typeof item === "string");
}

function resolveBaseUrl(document: OpenAPIDocument): string {
  const servers = Array.isArray(document.servers) ? document.servers : [];
  for (const server of servers) {
    const serverRecord = asRecord(server);
    if (typeof serverRecord.url === "string" && serverRecord.url.trim()) {
      return serverRecord.url.trim();
    }
  }
  return "http://localhost";
}

function resolveApiName(document: OpenAPIDocument): string {
  const info = asRecord(document.info);
  if (typeof info.title === "string" && info.title.trim()) {
    return info.title.trim();
  }
  return "Generated API";
}

function resolveApiDescription(document: OpenAPIDocument): string {
  const info = asRecord(document.info);
  const parts = [info.summary, info.description].filter((item): item is string => typeof item === "string");
  if (parts.length === 0) {
    return "Generated MCP server from OpenAPI specification.";
  }
  return truncateText(parts.join(" "), 420);
}

function normalizeToolName(operationId: string | undefined, method: string, path: string): string {
  const raw = operationId && operationId.trim() ? operationId : `${method}_${path}`;
  const fromPath = raw.replace(/[{}]/g, "").replace(/\//g, "_");
  return toSnakeCase(fromPath);
}

function resolveResponseDescription(operation: OpenAPIOperation): string | undefined {
  const responses = asRecord(operation.responses);
  const entries = Object.entries(responses);
  const success = entries.find(([status]) => /^2\d\d$/.test(status)) ?? entries.find(([status]) => status === "default");
  if (!success) {
    return undefined;
  }
  const responseObject = asRecord(success[1]);
  if (typeof responseObject.description === "string" && responseObject.description.trim()) {
    return truncateText(responseObject.description, 200);
  }
  return undefined;
}

function mergeParameters(pathParameters: unknown, operationParameters: unknown): OpenAPIParameter[] {
  const merged = new Map<string, OpenAPIParameter>();
  const pushParameter = (candidate: unknown): void => {
    const parameter = asRecord(candidate);
    const location = parameter.in;
    const name = parameter.name;
    if (typeof location !== "string" || typeof name !== "string") {
      return;
    }
    const key = `${location}:${name}`;
    merged.set(key, parameter);
  };

  if (Array.isArray(pathParameters)) {
    pathParameters.forEach(pushParameter);
  }
  if (Array.isArray(operationParameters)) {
    operationParameters.forEach(pushParameter);
  }

  return [...merged.values()];
}

function mapParameterToToolParameter(parameter: OpenAPIParameter): ToolParameter | null {
  const location = parameter.in;
  const name = parameter.name;
  if ((location !== "path" && location !== "query" && location !== "header") || typeof name !== "string") {
    return null;
  }

  const schema = asRecord(parameter.schema);
  const required = location === "path" ? true : parameter.required === true;
  const description =
    typeof parameter.description === "string" && parameter.description.trim()
      ? truncateText(parameter.description, 180)
      : `${location} parameter "${name}"`;

  const mapped: ToolParameter = {
    name,
    description,
    type: inferSchemaType(schema),
    required,
    location,
  };

  if (schema.default !== undefined) {
    mapped.default = schema.default;
  }
  if (Array.isArray(schema.enum)) {
    mapped.enum = schema.enum;
  }

  return mapped;
}

function mapRequestBody(operation: OpenAPIOperation): RequestBodyDef | undefined {
  const requestBody = asRecord(operation.requestBody) as OpenAPIRequestBody;
  const content = asRecord(requestBody.content);
  const contentTypes = Object.keys(content);
  if (contentTypes.length === 0) {
    return undefined;
  }

  const preferredType = contentTypes.includes("application/json") ? "application/json" : contentTypes[0];
  if (!preferredType) {
    return undefined;
  }

  const mediaType = asRecord(content[preferredType]);
  return {
    contentType: preferredType,
    schema: toJsonSchema(mediaType.schema),
    required: requestBody.required === true,
    description:
      typeof requestBody.description === "string" && requestBody.description.trim()
        ? truncateText(requestBody.description, 180)
        : undefined,
  };
}

function pickSecuritySchemeName(
  schemes: Record<string, unknown>,
  security: unknown,
): string | undefined {
  if (!Array.isArray(security)) {
    return undefined;
  }

  for (const requirement of security) {
    const requirementObject = asRecord(requirement);
    for (const key of Object.keys(requirementObject)) {
      if (Object.hasOwn(schemes, key)) {
        return key;
      }
    }
  }

  return undefined;
}

function collectOperationSecurityArrays(document: OpenAPIDocument): unknown[] {
  const arrays: unknown[] = [];
  const paths = asRecord(document.paths);
  for (const pathItem of Object.values(paths)) {
    const pathItemRecord = asRecord(pathItem);
    for (const [method, operation] of Object.entries(pathItemRecord)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      const operationRecord = asRecord(operation);
      if (Object.hasOwn(operationRecord, "security")) {
        arrays.push(operationRecord.security);
      }
    }
  }
  return arrays;
}

function detectAuthConfig(document: OpenAPIDocument): AuthConfig {
  const components = asRecord(document.components);
  const schemes = asRecord(components.securitySchemes);
  const schemeNames = Object.keys(schemes);
  const hasSecuritySchemes = schemeNames.length > 0;
  const globalSecurity = Array.isArray(document.security) ? document.security : undefined;
  const hasGlobalSecurityRequirement = Boolean(globalSecurity && globalSecurity.length > 0);
  const operationSecurityArrays = collectOperationSecurityArrays(document);
  const hasOperationNoAuthOverride = operationSecurityArrays.some(
    (security) => Array.isArray(security) && security.length === 0,
  );
  const authRequired = hasGlobalSecurityRequirement && !hasOperationNoAuthOverride;

  let selectedSchemeName = pickSecuritySchemeName(schemes, globalSecurity);

  if (!selectedSchemeName) {
    for (const securityArray of operationSecurityArrays) {
      selectedSchemeName = pickSecuritySchemeName(schemes, securityArray);
      if (selectedSchemeName) {
        break;
      }
    }
  }

  if (!selectedSchemeName) {
    selectedSchemeName = schemeNames[0];
  }

  if (!selectedSchemeName) {
    return {
      type: "none",
      envVarName: "NO_AUTH",
      description: "No authentication scheme detected.",
      required: false,
      hasSecuritySchemes,
    };
  }

  const scheme = asRecord(schemes[selectedSchemeName]);
  const description =
    typeof scheme.description === "string" && scheme.description.trim()
      ? scheme.description.trim()
      : `Authentication scheme: ${selectedSchemeName}`;

  if (scheme.type === "apiKey") {
    const inField = scheme.in;
    const headerName = typeof scheme.name === "string" ? scheme.name : "X-API-Key";
    return {
      type: "api-key",
      headerName: inField === "header" ? headerName : undefined,
      envVarName: "API_KEY",
      description,
      required: authRequired,
      hasSecuritySchemes,
    };
  }

  if (scheme.type === "http" && scheme.scheme === "basic") {
    return {
      type: "basic",
      headerName: "Authorization",
      scheme: "Basic",
      envVarName: "BASIC_AUTH",
      description,
      required: authRequired,
      hasSecuritySchemes,
    };
  }

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return {
      type: "bearer",
      headerName: "Authorization",
      scheme: "Bearer",
      envVarName: "ACCESS_TOKEN",
      description,
      required: authRequired,
      hasSecuritySchemes,
    };
  }

  if (scheme.type === "oauth2") {
    return {
      type: "oauth2",
      headerName: "Authorization",
      scheme: "Bearer",
      envVarName: "ACCESS_TOKEN",
      description,
      required: authRequired,
      hasSecuritySchemes,
    };
  }

  return {
    type: "none",
    envVarName: "NO_AUTH",
    description: "Unsupported authentication scheme detected. Continuing without auth.",
    required: false,
    hasSecuritySchemes,
  };
}

function convertOperationToTool(
  method: string,
  path: string,
  pathItem: OpenAPIPathItem,
  operation: OpenAPIOperation,
): ToolDefinition {
  const operationId =
    typeof operation.operationId === "string" && operation.operationId.trim() ? operation.operationId.trim() : undefined;
  const name = normalizeToolName(operationId, method, path);

  const summary = typeof operation.summary === "string" ? operation.summary.trim() : "";
  const description = typeof operation.description === "string" ? operation.description.trim() : "";
  const descriptionParts = [summary, description].filter(Boolean);
  const resolvedDescription =
    descriptionParts.length > 0
      ? truncateText(descriptionParts.join(" "), 260)
      : truncateText(`${method.toUpperCase()} ${path}`, 260);

  const mergedParameters = mergeParameters(pathItem.parameters, operation.parameters);
  const mappedParameters = mergedParameters
    .map((parameter) => mapParameterToToolParameter(parameter))
    .filter((parameter): parameter is ToolParameter => Boolean(parameter));

  const tool: ToolDefinition = {
    name,
    description: resolvedDescription,
    method: method.toUpperCase(),
    path,
    parameters: mappedParameters,
    requestBody: mapRequestBody(operation),
    responseDescription: resolveResponseDescription(operation),
    tags: asStringArray(operation.tags),
    originalOperationId: operationId,
  };

  return tool;
}

export async function parseOpenAPISpec(specSource: string): Promise<MCPForgeIR> {
  const parser = new SwaggerParser();

  try {
    await parser.validate(specSource);
    const dereferenced = (await parser.dereference(specSource)) as OpenAPIDocument;
    const paths = asRecord(dereferenced.paths);

    const tools: ToolDefinition[] = [];
    let rawEndpointCount = 0;

    for (const [path, pathItemRaw] of Object.entries(paths)) {
      const pathItem = asRecord(pathItemRaw);
      for (const [method, operationRaw] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) {
          continue;
        }
        const operation = asRecord(operationRaw);
        tools.push(convertOperationToTool(method, path, pathItem, operation));
        rawEndpointCount += 1;
      }
    }

    return {
      apiName: resolveApiName(dereferenced),
      apiDescription: resolveApiDescription(dereferenced),
      baseUrl: resolveBaseUrl(dereferenced),
      auth: detectAuthConfig(dereferenced),
      tools,
      rawEndpointCount,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown parser error";
    throw new Error(`Failed to parse OpenAPI spec "${specSource}": ${reason}`);
  }
}
