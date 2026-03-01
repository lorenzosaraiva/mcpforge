import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { MCPForgeIR, ToolDefinition } from "../parser/types.js";
import type { OptimizationOptions, OptimizationResult } from "./types.js";

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

function buildOptimizationPrompt(ir: MCPForgeIR): string {
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
    "",
    "Input IR JSON:",
    JSON.stringify(ir, null, 2),
  ].join("\n");
}

const DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION = 200;
const DEFAULT_OPTIMIZATION_CHUNK_SIZE = 50;
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
  const maxEndpointsForOptimization = options.maxEndpointsForOptimization ?? DEFAULT_MAX_ENDPOINTS_FOR_OPTIMIZATION;
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

async function optimizeSingleIR(
  client: Anthropic,
  ir: MCPForgeIR,
  options: OptimizationOptions,
): Promise<MCPForgeIR> {
  const prompt = buildOptimizationPrompt(ir);

  const response = await client.messages.create({
    model: options.model ?? "claude-sonnet-4-20250514",
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
    system:
      "You are an expert API designer who specializes in LLM tool interfaces. Your outputs must be concise, practical, and strictly valid JSON when requested.",
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
    throw new Error("Anthropic returned an empty response.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonPayload(text));
  } catch (error) {
    throw new Error(
      `Failed to parse optimizer JSON response: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  const validated = MCPForgeIRSchema.parse(parsedJson);
  validated.auth.required = validated.auth.required ?? ir.auth.required ?? false;
  validated.auth.hasSecuritySchemes =
    validated.auth.hasSecuritySchemes ?? ir.auth.hasSecuritySchemes ?? validated.auth.type !== "none";
  if (validated.rawEndpointCount <= 0) {
    validated.rawEndpointCount = ir.rawEndpointCount;
  }
  return validated;
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

  const optimizationChunkSize = options.optimizationChunkSize ?? DEFAULT_OPTIMIZATION_CHUNK_SIZE;
  if (selectedTools.length <= optimizationChunkSize) {
    const optimizedIR = await optimizeSingleIR(client, scopedIR, options);
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
      tools: dedupeToolNames(optimizedTools),
      rawEndpointCount: ir.rawEndpointCount,
    },
    skipped: false,
  };
}
