import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type {
  AuthConfig,
  EndpointToolDefinition,
  MCPForgeIR,
  ToolParameter,
} from "../parser/types.js";
import { toSnakeCase, truncateText } from "../utils/schema-utils.js";
import type { ScrapedDocPage } from "./docs-scraper.js";

export interface InferFromDocsOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  logger?: (message: string) => void;
  maxCharsPerChunk?: number;
  maxCharsPerPage?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_CHARS_PER_CHUNK = 550_000;
const DEFAULT_MAX_CHARS_PER_PAGE = 60_000;

const ParameterSchema = z.object({
  name: z.string().min(1),
  location: z.enum(["path", "query", "header"]),
  type: z.string().default("string"),
  required: z.boolean().default(false),
  description: z.string().default(""),
});

const RequestBodySchema = z.object({
  contentType: z.string().default("application/json"),
  schema: z.record(z.string(), z.unknown()).default({}),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

const EndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string().min(1),
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  parameters: z.array(ParameterSchema).default([]),
  requestBody: RequestBodySchema.nullable().optional(),
  responseDescription: z.string().optional(),
});

const InferredStructureSchema = z.object({
  apiName: z.string().default("Inferred API"),
  apiDescription: z.string().default("API inferred from documentation pages."),
  baseUrl: z.string().default("http://localhost"),
  auth: z.object({
    type: z.enum(["none", "api-key", "bearer", "oauth2", "basic"]),
    headerName: z.string().nullable().optional(),
    scheme: z.string().nullable().optional(),
    envVarName: z.string().optional(),
    description: z.string().default(""),
  }),
  endpoints: z.array(EndpointSchema).default([]),
});

type InferredStructure = z.infer<typeof InferredStructureSchema>;
type InferredEndpoint = z.infer<typeof EndpointSchema>;

function defaultLogger(message: string): void {
  process.stderr.write(`${message}\n`);
}

function extractJsonPayload(responseText: string): string {
  const fencedMatch = responseText.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const genericFenceMatch = responseText.match(/```\s*([\s\S]*?)```/);
  if (genericFenceMatch?.[1]) {
    return genericFenceMatch[1].trim();
  }
  return responseText.trim();
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeParamType(rawType: string): string {
  const type = rawType.trim().toLowerCase();
  if (["string", "integer", "boolean", "number", "array", "object"].includes(type)) {
    return type;
  }
  return "string";
}

function deriveOperationId(method: string, path: string): string {
  const fromPath = `${method.toLowerCase()}_${path}`.replace(/[{}]/g, "").replace(/\//g, "_");
  return toSnakeCase(fromPath);
}

function inferEnvVarName(auth: InferredStructure["auth"]): string {
  if (auth.envVarName && auth.envVarName.trim()) {
    return auth.envVarName.trim();
  }
  switch (auth.type) {
    case "api-key":
      return "API_KEY";
    case "bearer":
    case "oauth2":
      return "ACCESS_TOKEN";
    case "basic":
      return "BASIC_AUTH";
    default:
      return "NO_AUTH";
  }
}

function inferHeaderName(auth: InferredStructure["auth"]): string | undefined {
  if (auth.headerName && auth.headerName.trim()) {
    return auth.headerName.trim();
  }
  if (auth.type === "api-key") {
    return "X-API-Key";
  }
  if (auth.type === "bearer" || auth.type === "oauth2" || auth.type === "basic") {
    return "Authorization";
  }
  return undefined;
}

function inferScheme(auth: InferredStructure["auth"]): string | undefined {
  if (auth.scheme && auth.scheme.trim()) {
    return auth.scheme.trim();
  }
  if (auth.type === "bearer" || auth.type === "oauth2") {
    return "Bearer";
  }
  if (auth.type === "basic") {
    return "Basic";
  }
  return undefined;
}

function toIRAuth(auth: InferredStructure["auth"]): AuthConfig {
  const type = auth.type;
  const envVarName = inferEnvVarName(auth);
  return {
    type,
    headerName: inferHeaderName(auth),
    scheme: inferScheme(auth),
    envVarName,
    description:
      auth.description && auth.description.trim()
        ? truncateText(auth.description, 280)
        : "Authentication inferred from API documentation.",
    required: type !== "none",
    hasSecuritySchemes: type !== "none",
  };
}

function endpointConfidenceScore(endpoint: InferredEndpoint): number {
  let score = 0;
  score += endpoint.parameters.length * 2;
  score += endpoint.requestBody ? 5 : 0;
  score += endpoint.description ? Math.min(endpoint.description.length / 80, 5) : 0;
  score += endpoint.summary ? 1 : 0;
  return score;
}

function mergeInferredStructures(chunks: InferredStructure[]): InferredStructure {
  const first = chunks[0] ?? {
    apiName: "Inferred API",
    apiDescription: "API inferred from documentation pages.",
    baseUrl: "http://localhost",
    auth: {
      type: "none" as const,
      headerName: null,
      scheme: null,
      envVarName: "NO_AUTH",
      description: "No authentication inferred.",
    },
    endpoints: [],
  };

  const endpointByMethodPath = new Map<string, InferredEndpoint>();
  for (const chunk of chunks) {
    for (const endpoint of chunk.endpoints) {
      const key = `${endpoint.method.toUpperCase()} ${normalizePath(endpoint.path)}`;
      const existing = endpointByMethodPath.get(key);
      if (!existing || endpointConfidenceScore(endpoint) > endpointConfidenceScore(existing)) {
        endpointByMethodPath.set(key, endpoint);
      }
    }
  }

  const authCandidates = chunks.map((chunk) => chunk.auth);
  const selectedAuth =
    authCandidates.find((auth) => auth.type !== "none") ?? first.auth;

  return {
    apiName: chunks
      .map((chunk) => chunk.apiName.trim())
      .find((name) => name.length > 0) ?? first.apiName,
    apiDescription: chunks
      .map((chunk) => chunk.apiDescription.trim())
      .sort((left, right) => right.length - left.length)[0] ?? first.apiDescription,
    baseUrl: chunks
      .map((chunk) => chunk.baseUrl.trim())
      .find((value) => /^https?:\/\//i.test(value)) ?? first.baseUrl,
    auth: selectedAuth,
    endpoints: [...endpointByMethodPath.values()],
  };
}

function toToolDefinition(endpoint: InferredEndpoint): EndpointToolDefinition {
  const method = endpoint.method.toUpperCase();
  const path = normalizePath(endpoint.path);
  const operationId = endpoint.operationId?.trim()
    ? toSnakeCase(endpoint.operationId.trim())
    : deriveOperationId(method, path);

  const summary = endpoint.summary?.trim() ?? "";
  const description = endpoint.description?.trim() ?? "";
  const resolvedDescription = truncateText(
    [summary, description].filter(Boolean).join(" ").trim() || `${method} ${path}`,
    260,
  );

  const parameters: ToolParameter[] = endpoint.parameters.map((parameter: InferredEndpoint["parameters"][number]) => ({
    name: parameter.name.trim(),
    description: truncateText(parameter.description || `${parameter.location} parameter "${parameter.name}"`, 180),
    type: normalizeParamType(parameter.type),
    required: parameter.required === true,
    location: parameter.location,
  }));

  return {
    kind: "endpoint",
    name: operationId,
    description: resolvedDescription,
    method,
    path,
    parameters,
    requestBody:
      endpoint.requestBody && endpoint.requestBody.schema
        ? {
            contentType: endpoint.requestBody.contentType || "application/json",
            schema: endpoint.requestBody.schema,
            required: endpoint.requestBody.required === true,
            description: endpoint.requestBody.description
              ? truncateText(endpoint.requestBody.description, 180)
              : undefined,
          }
        : undefined,
    responseDescription: endpoint.responseDescription
      ? truncateText(endpoint.responseDescription, 200)
      : undefined,
    tags: [],
    originalOperationId: operationId,
  };
}

function toIR(inferred: InferredStructure): MCPForgeIR {
  const tools = inferred.endpoints.map((endpoint) => toToolDefinition(endpoint));
  return {
    apiName: inferred.apiName.trim() || "Inferred API",
    apiDescription:
      inferred.apiDescription.trim() || "API inferred from documentation pages.",
    baseUrl: inferred.baseUrl.trim() || "http://localhost",
    auth: toIRAuth(inferred.auth),
    tools,
    rawEndpointCount: tools.length,
  };
}

function preparePageContent(page: ScrapedDocPage, maxCharsPerPage: number): ScrapedDocPage {
  const normalizedContent = page.content.trim();
  if (normalizedContent.length <= maxCharsPerPage) {
    return { ...page, content: normalizedContent };
  }

  const truncated = normalizedContent.slice(0, maxCharsPerPage);
  return {
    ...page,
    content: `${truncated}\n\n[Truncated by MCPForge due to size limits]`,
  };
}

function chunkScrapedDocs(
  pages: ScrapedDocPage[],
  maxCharsPerChunk: number,
  maxCharsPerPage: number,
): ScrapedDocPage[][] {
  const preparedPages = pages.map((page) => preparePageContent(page, maxCharsPerPage));
  const chunks: ScrapedDocPage[][] = [];
  let currentChunk: ScrapedDocPage[] = [];
  let currentChars = 0;

  for (const page of preparedPages) {
    const pageChars = page.content.length + page.url.length + 48;
    if (currentChunk.length > 0 && currentChars + pageChars > maxCharsPerChunk) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }
    currentChunk.push(page);
    currentChars += pageChars;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [preparedPages];
}

function buildInferencePrompt(
  pages: ScrapedDocPage[],
  chunkIndex: number,
  totalChunks: number,
): string {
  const docsBlock = pages
    .map(
      (page, index) =>
        [
          `### Documentation Page ${index + 1}`,
          `URL: ${page.url}`,
          "Content:",
          page.content,
        ].join("\n"),
    )
    .join("\n\n");

  return [
    `Analyze documentation chunk ${chunkIndex + 1} of ${totalChunks}.`,
    "",
    "You are an API reverse-engineering expert. I'm going to give you documentation pages from a REST API.",
    "Your job is to extract the API structure and return it as a structured JSON object.",
    "",
    "From the documentation, extract:",
    "- API name and description",
    "- Base URL for the API",
    "- Authentication method and how to configure it",
    "- For each endpoint: method, path, operationId, summary, description, parameters, request body",
    "",
    "Important:",
    "- Infer types from examples when explicit types are missing.",
    "- Use snake_case for operationId derived from method + path if needed.",
    "- If required status is unclear, set required=false.",
    "- Include only endpoints you are reasonably confident about.",
    "- Prefer fewer accurate endpoints over many guessed ones.",
    "",
    "Return ONLY valid JSON matching this exact schema:",
    "{",
    '  "apiName": "string",',
    '  "apiDescription": "string",',
    '  "baseUrl": "string",',
    '  "auth": {',
    '    "type": "none | api-key | bearer | oauth2 | basic",',
    '    "headerName": "string or null",',
    '    "scheme": "string or null",',
    '    "envVarName": "string",',
    '    "description": "string explaining how to get credentials"',
    "  },",
    '  "endpoints": [',
    "    {",
    '      "method": "GET|POST|PUT|DELETE|PATCH",',
    '      "path": "/users/{id}",',
    '      "operationId": "get_user_by_id",',
    '      "summary": "short description",',
    '      "description": "longer description",',
    '      "parameters": [',
    "        {",
    '          "name": "id",',
    '          "location": "path|query|header",',
    '          "type": "string|integer|boolean|number",',
    '          "required": true,',
    '          "description": "description"',
    "        }",
    "      ],",
    '      "requestBody": {',
    '        "contentType": "application/json",',
    '        "schema": {},',
    '        "required": true,',
    '        "description": "description"',
    "      }",
    "    }",
    "  ]",
    "}",
    "",
    docsBlock,
  ].join("\n");
}

async function inferChunk(
  client: Anthropic,
  pages: ScrapedDocPage[],
  chunkIndex: number,
  totalChunks: number,
  options: InferFromDocsOptions,
): Promise<InferredStructure> {
  const prompt = buildInferencePrompt(pages, chunkIndex, totalChunks);
  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    system:
      "You are an expert API designer who specializes in reverse-engineering REST APIs from documentation for LLM tool interfaces. Output only strict JSON when requested.",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const text = response.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error(`AI inferrer returned empty response for chunk ${chunkIndex + 1}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(text));
  } catch (error) {
    throw new Error(
      `Failed to parse AI inferrer JSON for chunk ${chunkIndex + 1}: ${
        error instanceof Error ? error.message : "Unknown parse error"
      }`,
    );
  }

  return InferredStructureSchema.parse(parsed);
}

export async function inferIRFromDocs(
  pages: ScrapedDocPage[],
  options: InferFromDocsOptions = {},
): Promise<MCPForgeIR> {
  const logger = options.logger ?? defaultLogger;
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("--from-url requires ANTHROPIC_API_KEY to infer API structure from documentation.");
  }

  if (pages.length === 0) {
    throw new Error("No scraped documentation pages were provided.");
  }

  const maxCharsPerChunk = options.maxCharsPerChunk ?? DEFAULT_MAX_CHARS_PER_CHUNK;
  const maxCharsPerPage = options.maxCharsPerPage ?? DEFAULT_MAX_CHARS_PER_PAGE;
  const chunks = chunkScrapedDocs(pages, maxCharsPerChunk, maxCharsPerPage);
  const client = new Anthropic({ apiKey });

  const chunkResults: InferredStructure[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkPages = chunks[index] ?? [];
    logger(
      `[mcpforge] Inferring API structure from docs chunk ${index + 1}/${chunks.length} (${chunkPages.length} page(s)).`,
    );
    const inferredChunk = await inferChunk(client, chunkPages, index, chunks.length, options);
    chunkResults.push(inferredChunk);
  }

  const merged = mergeInferredStructures(chunkResults);
  const ir = toIR(merged);

  if (ir.tools.length === 0) {
    throw new Error(
      "AI inferrer did not identify any confident endpoints from the documentation pages.",
    );
  }

  return ir;
}
