import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { MCPForgeIR, ToolDefinition } from "../parser/types.js";
import type { OptimizationOptions, OptimizationResult, OptimizerMode } from "./types.js";

const ToolPrioritySchema = z.enum(["high", "medium", "low"]);

const ToolParameterSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string(),
  required: z.boolean(),
  location: z.enum(["path", "query", "header"]),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
});

const RequestBodySchema = z.object({
  contentType: z.string(),
  schema: z.record(z.string(), z.unknown()),
  required: z.boolean(),
  description: z.string().optional(),
});

const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  parameters: z.array(ToolParameterSchema),
  requestBody: RequestBodySchema.optional(),
  responseDescription: z.string().optional(),
  tags: z.array(z.string()),
  originalOperationId: z.string().optional(),
  priority: ToolPrioritySchema.optional(),
});

const AuthConfigSchema = z.object({
  type: z.enum(["none", "api-key", "bearer", "oauth2", "basic"]),
  headerName: z.string().optional(),
  scheme: z.string().optional(),
  envVarName: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hasSecuritySchemes: z.boolean().optional(),
});

const MCPForgeIRSchema = z.object({
  apiName: z.string(),
  apiDescription: z.string(),
  baseUrl: z.string(),
  auth: AuthConfigSchema,
  tools: z.array(ToolDefinitionSchema),
  rawEndpointCount: z.number().int().nonnegative(),
});

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

function buildOptimizationPrompt(ir: MCPForgeIR, mode: OptimizerMode, maxTools: number): string {
  const strictModeInstructions =
    mode === "strict"
      ? [
          "",
          `STRICT MODE: You must return NO MORE THAN ${maxTools} tools (default 25). To achieve this:`,
          "- Only include the endpoints that a typical user would need in 90% of use cases.",
          "- Aggressively merge CRUD operations on the same resource into single tools with an 'action' parameter when it makes sense.",
          "- Drop anything that's admin-only, rarely used, or niche.",
          "- Prioritize: read operations > create operations > update operations > delete operations.",
          "- If the API has clear 'core' vs 'extended' functionality, only include core.",
          `- Think about it this way: if you were briefing a new employee on this API and could only show them ${maxTools} tools, which would you pick?`,
        ]
      : [
          "",
          `STANDARD MODE: Keep broad practical coverage but return NO MORE THAN ${maxTools} tools (default 80).`,
          "- Keep high-value endpoints for common workflows.",
          "- Remove obvious admin/internal/noise endpoints.",
          "- Merge near-duplicate CRUD tools where it improves usability.",
        ];

  return [
    "Optimize this MCPForge IR for LLM usability.",
    "",
    "Critical rules:",
    "- Preserve the exact IR JSON schema format and field names.",
    "- Return ONLY valid JSON. No markdown. No code fences. No commentary.",
    '- A tool with 20+ parameters is useless for an LLM. Break it down or simplify.',
    "- Write descriptions as if briefing a competent assistant.",
    "- Description style: start with a verb, be specific, mention what the tool returns.",
    "- Remove health check endpoints, OpenAPI spec endpoints, and admin/internal routes users do not need.",
    "- Remove deprecated or low-value endpoints unless absolutely necessary.",
    "",
    "Examples of BAD vs GOOD tool design:",
    "",
    "Example 1 (too many parameters):",
    "BAD:",
    '{ "name": "search_everything", "parameters": [/* 27 mixed filters */] }',
    "GOOD:",
    '{ "name": "search_orders", "parameters": [\"query\", \"status\", \"page\"], "description": "Search orders by text and status, returning matching orders and pagination metadata." }',
    "",
    "Example 2 (endpoint-shaped description):",
    "BAD:",
    '{ "name": "get_users_id", "description": "GET /users/{id}" }',
    "GOOD:",
    '{ "name": "get_user", "description": "Fetch a user by ID and return profile details, roles, and account status." }',
    "",
    "Example 3 (noise endpoints):",
    "BAD:",
    '[{\"name\":\"health_check\"}, {\"name\":\"get_openapi_json\"}, {\"name\":\"admin_reindex\"}]',
    "GOOD:",
    '[{\"name\":\"list_products\"}, {\"name\":\"get_product\"}, {\"name\":\"update_inventory\"}]',
    "",
    "Output must match this IR schema:",
    "{",
    '  "apiName": string,',
    '  "apiDescription": string,',
    '  "baseUrl": string,',
    '  "auth": {',
    '    "type": "none" | "api-key" | "bearer" | "oauth2" | "basic",',
    '    "headerName"?: string,',
    '    "scheme"?: string,',
    '    "envVarName": string,',
    '    "description"?: string,',
    '    "required"?: boolean,',
    '    "hasSecuritySchemes"?: boolean',
    "  },",
    '  "tools": [',
    "    {",
    '      "name": string,',
    '      "description": string,',
    '      "method": string,',
    '      "path": string,',
    '      "parameters": [',
    "        {",
    '          "name": string,',
    '          "description": string,',
    '          "type": string,',
    '          "required": boolean,',
    '          "location": "path" | "query" | "header",',
    '          "default"?: any,',
    '          "enum"?: any[]',
    "        }",
    "      ],",
    '      "requestBody"?: {',
    '        "contentType": string,',
    '        "schema": object,',
    '        "required": boolean,',
    '        "description"?: string',
    "      },",
    '      "responseDescription"?: string,',
    '      "tags": string[],',
    '      "originalOperationId"?: string,',
    '      "priority"?: "high" | "medium" | "low"',
    "    }",
    "  ],",
    '  "rawEndpointCount": number',
    "}",
    "",
    "Optimization checklist:",
    "1) Group related endpoints into fewer, clearer tools only when it improves usability.",
    "2) Keep high-value tools for common user tasks.",
    "3) Set tool priority to high, medium, or low.",
    "4) Keep auth and API metadata accurate.",
    "5) Keep rawEndpointCount aligned with original endpoint count.",
    `6) Return at most ${maxTools} tools.`,
    ...strictModeInstructions,
    "",
    "Input IR JSON:",
    JSON.stringify(ir, null, 2),
  ].join("\n");
}

const DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION_STANDARD = 200;
const DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION_STRICT = 80;
const DEFAULT_OPTIMIZATION_CHUNK_SIZE_STANDARD = 50;
const DEFAULT_OPTIMIZATION_CHUNK_SIZE_STRICT = 25;
const DEFAULT_OPTIMIZER_MODE: OptimizerMode = "strict";
const DEFAULT_MAX_TOOLS_STRICT = 25;
const DEFAULT_MAX_TOOLS_STANDARD = 80;
const DEFAULT_OPTIMIZER_MAX_TOKENS = 8192;
const MAX_JSON_RETRY_ATTEMPTS = 2;
const DEFAULT_PREFERRED_TAGS_FOR_LARGE_APIS = [
  "payments",
  "payment",
  "customers",
  "customer",
  "subscriptions",
  "subscription",
  "invoices",
  "invoice",
  "charges",
  "charge",
  "refunds",
  "refund",
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreToolByPreferredTags(tool: ToolDefinition, preferredTags: string[]): number {
  const toolTags = tool.tags.map((tag) => normalizeText(tag));
  const name = normalizeText(tool.name);
  const path = normalizeText(tool.path);

  let score = 0;
  for (const preferredTag of preferredTags) {
    if (toolTags.some((tag) => tag.includes(preferredTag))) {
      score += 10;
    }
    if (name.includes(preferredTag)) {
      score += 6;
    }
    if (path.includes(preferredTag)) {
      score += 4;
    }
  }

  return score;
}

function selectToolsForOptimization(
  ir: MCPForgeIR,
  options: OptimizationOptions,
  logger: (message: string) => void,
): ToolDefinition[] {
  const mode = resolveMode(options);
  const maxEndpointsForOptimization =
    options.maxEndpointsForOptimization ??
    (mode === "strict"
      ? DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION_STRICT
      : DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION_STANDARD);
  if (maxEndpointsForOptimization <= 0 || ir.tools.length <= maxEndpointsForOptimization) {
    return ir.tools;
  }

  const preferredTags = (options.preferredTagsForOptimization ?? DEFAULT_PREFERRED_TAGS_FOR_LARGE_APIS).map((tag) =>
    normalizeText(tag),
  );
  const scored = ir.tools.map((tool, index) => ({
    tool,
    index,
    score: scoreToolByPreferredTags(tool, preferredTags),
  }));

  const hasMeaningfulScores = scored.some((entry) => entry.score > 0);
  let selected: ToolDefinition[];

  if (hasMeaningfulScores) {
    selected = scored
      .slice()
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, maxEndpointsForOptimization)
      .map((entry) => entry.tool);
    logger(
      `[mcpforge] Large API detected (${ir.tools.length} tools). Limiting optimization scope to ${selected.length} tools prioritized by tags: ${preferredTags.join(", ")}.`,
    );
  } else {
    selected = ir.tools.slice(0, maxEndpointsForOptimization);
    logger(
      `[mcpforge] Large API detected (${ir.tools.length} tools). Limiting optimization scope to first ${selected.length} tools.`,
    );
  }

  return selected;
}

function isContextLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("prompt is too long") ||
    message.includes("too many tokens") ||
    message.includes("context length") ||
    message.includes("maximum context") ||
    message.includes("token limit")
  );
}

function isRecoverableChunkError(error: unknown): boolean {
  if (isContextLimitError(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("failed to parse optimizer json response") ||
    message.includes("unterminated string") ||
    message.includes("unexpected end of json input")
  );
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("rate limit");
}

function resolveMode(options: OptimizationOptions): OptimizerMode {
  return options.mode ?? DEFAULT_OPTIMIZER_MODE;
}

function resolveMaxTools(options: OptimizationOptions, mode: OptimizerMode): number {
  const fallback = mode === "strict" ? DEFAULT_MAX_TOOLS_STRICT : DEFAULT_MAX_TOOLS_STANDARD;
  const candidate = options.maxTools;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return fallback;
  }
  const floored = Math.floor(candidate);
  if (floored <= 0) {
    return fallback;
  }
  return floored;
}

function toolPriorityScore(tool: ToolDefinition): number {
  if (tool.priority === "high") {
    return 0;
  }
  if (tool.priority === "medium") {
    return 1;
  }
  if (tool.priority === "low") {
    return 2;
  }
  return 1;
}

function methodScore(method: string): number {
  const upper = method.toUpperCase();
  if (upper === "GET") {
    return 0;
  }
  if (upper === "POST") {
    return 1;
  }
  if (upper === "PUT" || upper === "PATCH") {
    return 2;
  }
  if (upper === "DELETE") {
    return 3;
  }
  return 4;
}

function capTools(tools: ToolDefinition[], maxTools: number): ToolDefinition[] {
  if (tools.length <= maxTools) {
    return tools;
  }

  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((left, right) => {
      const priorityDelta = toolPriorityScore(left.tool) - toolPriorityScore(right.tool);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      const methodDelta = methodScore(left.tool.method) - methodScore(right.tool.method);
      if (methodDelta !== 0) {
        return methodDelta;
      }
      return left.index - right.index;
    })
    .slice(0, maxTools)
    .map((entry) => entry.tool);
}

async function optimizeSingleIR(
  client: Anthropic,
  ir: MCPForgeIR,
  options: OptimizationOptions,
): Promise<MCPForgeIR> {
  const mode = resolveMode(options);
  const maxTools = resolveMaxTools(options, mode);
  const prompt = buildOptimizationPrompt(ir, mode, maxTools);

  for (let attempt = 0; attempt <= MAX_JSON_RETRY_ATTEMPTS; attempt += 1) {
    const retrySuffix =
      attempt === 0
        ? ""
        : "\n\nYour previous response was not valid JSON. Return only valid JSON matching the schema exactly.";
    const response = await client.messages.create({
      model: options.model ?? "claude-sonnet-4-20250514",
      max_tokens: options.maxTokens ?? DEFAULT_OPTIMIZER_MAX_TOKENS,
      temperature: options.temperature ?? 0.3,
      system:
        "You are an expert API designer who specializes in LLM tool interfaces. Your outputs must be concise, practical, and strictly valid JSON when requested.",
      messages: [
        {
          role: "user",
          content: `${prompt}${retrySuffix}`,
        },
      ],
    });

    const text = response.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();

    if (!text) {
      if (attempt === MAX_JSON_RETRY_ATTEMPTS) {
        throw new Error("Anthropic returned an empty response.");
      }
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonPayload(text));
    } catch (error) {
      if (attempt === MAX_JSON_RETRY_ATTEMPTS) {
        throw new Error(
          `Failed to parse optimizer JSON response: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
      continue;
    }

    const validated = MCPForgeIRSchema.parse(parsedJson);
    validated.auth.required = validated.auth.required ?? ir.auth.required ?? false;
    validated.auth.hasSecuritySchemes =
      validated.auth.hasSecuritySchemes ?? ir.auth.hasSecuritySchemes ?? validated.auth.type !== "none";
    if (validated.rawEndpointCount <= 0) {
      validated.rawEndpointCount = ir.rawEndpointCount;
    }
    validated.tools = capTools(validated.tools, maxTools);
    return validated;
  }

  throw new Error("Failed to obtain a valid optimizer response.");
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function dedupeToolNames(tools: ToolDefinition[]): ToolDefinition[] {
  const counts = new Map<string, number>();
  return tools.map((tool) => {
    const seen = counts.get(tool.name) ?? 0;
    counts.set(tool.name, seen + 1);
    if (seen === 0) {
      return tool;
    }
    return {
      ...tool,
      name: `${tool.name}_${seen + 1}`,
    };
  });
}

async function optimizeChunkRecursively(
  client: Anthropic,
  baseIR: MCPForgeIR,
  tools: ToolDefinition[],
  options: OptimizationOptions,
  logger: (message: string) => void,
  retryCount = 0,
): Promise<ToolDefinition[]> {
  const chunkIR: MCPForgeIR = {
    ...baseIR,
    tools,
  };

  try {
    const optimizedChunk = await optimizeSingleIR(client, chunkIR, options);
    return optimizedChunk.tools;
  } catch (error) {
    if (isRateLimitError(error) && retryCount < 2) {
      logger(
        `[mcpforge] Rate limit hit while optimizing chunk size ${tools.length}. Waiting 65s before retry ${retryCount + 1}/2.`,
      );
      await new Promise((resolve) => setTimeout(resolve, 65000));
      return optimizeChunkRecursively(client, baseIR, tools, options, logger, retryCount + 1);
    }

    if (tools.length > 1 && isRecoverableChunkError(error)) {
      const middle = Math.ceil(tools.length / 2);
      logger(
        `[mcpforge] Optimizer chunk failed for size ${tools.length}. Retrying with chunks of ${middle} and ${tools.length - middle}.`,
      );
      const left = await optimizeChunkRecursively(
        client,
        baseIR,
        tools.slice(0, middle),
        options,
        logger,
        0,
      );
      const right = await optimizeChunkRecursively(
        client,
        baseIR,
        tools.slice(middle),
        options,
        logger,
        0,
      );
      return [...left, ...right];
    }
    throw error;
  }
}

export async function optimizeIRWithAI(
  ir: MCPForgeIR,
  options: OptimizationOptions = {},
): Promise<OptimizationResult> {
  const logger = options.logger ?? defaultLogger;
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const mode = resolveMode(options);
  const maxTools = resolveMaxTools(options, mode);

  if (!apiKey) {
    logger("[mcpforge] ANTHROPIC_API_KEY not found. Skipping AI optimization.");
    return {
      optimizedIR: ir,
      skipped: true,
      reason: "ANTHROPIC_API_KEY not configured",
    };
  }

  const client = new Anthropic({ apiKey });
  const selectedTools = selectToolsForOptimization(ir, options, logger);
  const scopedIR: MCPForgeIR = {
    ...ir,
    tools: selectedTools,
  };

  const optimizationChunkSize =
    options.optimizationChunkSize ??
    (mode === "strict" ? DEFAULT_OPTIMIZATION_CHUNK_SIZE_STRICT : DEFAULT_OPTIMIZATION_CHUNK_SIZE_STANDARD);
  if (selectedTools.length <= optimizationChunkSize) {
    const optimizedIR = await optimizeSingleIR(client, scopedIR, options);
    if (optimizedIR.tools.length > maxTools) {
      logger(
        `[mcpforge] Optimizer returned ${optimizedIR.tools.length} tools in ${mode} mode. Trimming to ${maxTools}.`,
      );
      optimizedIR.tools = capTools(optimizedIR.tools, maxTools);
    }
    optimizedIR.rawEndpointCount = ir.rawEndpointCount;
    return {
      optimizedIR,
      skipped: false,
    };
  }

  logger(
    `[mcpforge] Running chunked optimization: ${selectedTools.length} tools split in chunks of ${optimizationChunkSize}.`,
  );
  const chunks = splitIntoChunks(selectedTools, optimizationChunkSize);
  const optimizedTools: ToolDefinition[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? [];
    logger(`[mcpforge] Optimizing chunk ${index + 1}/${chunks.length} (${chunk.length} tools).`);
    const chunkTools = await optimizeChunkRecursively(client, scopedIR, chunk, options, logger);
    optimizedTools.push(...chunkTools);
  }

  return {
    optimizedIR: {
      ...ir,
      tools: capTools(dedupeToolNames(optimizedTools), maxTools),
      rawEndpointCount: ir.rawEndpointCount,
    },
    skipped: false,
  };
}
