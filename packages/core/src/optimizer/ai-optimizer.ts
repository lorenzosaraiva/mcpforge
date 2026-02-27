import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { MCPForgeIR } from "../parser/types.js";
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

  return {
    optimizedIR: validated,
    skipped: false,
  };
}
