import { describe, expect, it } from "vitest";

import type { MCPForgeIR, ToolDefinition } from "../core.js";
import { resolveSelectedToolsForIR } from "./tool-selection.js";

function createIR(tools: ToolDefinition[]): MCPForgeIR {
  return {
    apiName: "Test API",
    apiDescription: "Test API",
    baseUrl: "https://api.example.com",
    auth: {
      type: "none",
      envVarName: "NO_AUTH",
      required: false,
      hasSecuritySchemes: false,
    },
    tools,
    rawEndpointCount: tools.length,
  };
}

describe("resolveSelectedToolsForIR", () => {
  it("supports workflow tools by name and endpoints by operationId", () => {
    const ir = createIR([
      {
        kind: "workflow",
        name: "find_customers",
        description: "Find customers",
        tags: ["customers"],
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string" },
          },
          additionalProperties: false,
        },
        dependsOnOperationIds: ["list_customers"],
        steps: [
          {
            id: "find_customers_step",
            operationId: "list_customers",
            args: {
              email: { $fromInput: "email" },
            },
          },
        ],
      },
      {
        kind: "endpoint",
        name: "create_customer",
        originalOperationId: "create_customer",
        description: "Create customer",
        method: "POST",
        path: "/v1/customers",
        parameters: [],
        tags: ["customers"],
      },
    ]);

    expect(resolveSelectedToolsForIR(ir, ["find_customers", "create_customer"])).toEqual([
      "find_customers",
      "create_customer",
    ]);
  });
});
