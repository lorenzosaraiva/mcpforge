#!/usr/bin/env node

import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { handleGetStatus } from "./tools/get_status.js";

const SERVER_NAME = ".tmp-noauth-server";
const SERVER_VERSION = "0.1.0";
const DEFAULT_API_BASE_URL = "https://example.com/api";
const API_BASE_URL = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
const AUTH_HEADERS: Record<string, string> = {};

const TOOL_DEFINITIONS = [
  {
    name: "get_status",
    description: "Get status",
    inputSchema: {
  "type": "object",
  "properties": {},
  "additionalProperties": false
},
  }
];

const TOOL_HANDLERS: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
  "get_status": (input) =>
    handleGetStatus(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    })
};

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const toolName = request.params.name;
  const rawArgs = request.params.arguments;
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  const toolHandler = TOOL_HANDLERS[toolName];

  if (!toolHandler) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${toolName}`,
        },
      ],
    };
  }

  try {
    const result = await toolHandler(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool "${toolName}" failed: ${message}`,
        },
      ],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`MCP server failed to start: ${message}\n`);
  process.exit(1);
});
