import { describe, expect, it } from "vitest";

import type { EndpointToolDefinition, MCPForgeIR, WorkflowToolDefinition } from "../parser/types.js";
import { diffIR } from "./ir-differ.js";

function createWorkflowTool(
  overrides: Partial<WorkflowToolDefinition> & Pick<WorkflowToolDefinition, "name">,
): WorkflowToolDefinition {
  const { name, ...rest } = overrides;
  return {
    kind: "workflow",
    name,
    description: "Workflow description",
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
        saveAs: "find_customers_step",
      },
    ],
    output: { $fromStep: "find_customers_step" },
    ...rest,
  };
}

function createIR(tool: WorkflowToolDefinition): MCPForgeIR {
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
    tools: [tool],
    rawEndpointCount: 1,
  };
}

describe("diffIR", () => {
  it("flags workflow dependency changes as high risk", () => {
    const oldIR = createIR(
      createWorkflowTool({
        name: "find_customers",
        dependsOnOperationIds: ["list_customers"],
      }),
    );
    const newIR = createIR(
      createWorkflowTool({
        name: "find_customers",
        dependsOnOperationIds: ["search_customers"],
        steps: [
          {
            id: "find_customers_step",
            operationId: "search_customers",
            args: {
              email: { $fromInput: "email" },
            },
            saveAs: "find_customers_step",
          },
        ],
      }),
    );

    const result = diffIR(oldIR, newIR);

    expect(result.summary.high).toBeGreaterThan(0);
    expect(result.changes.some((change) => change.details === "Workflow dependencies changed.")).toBe(true);
  });

  it("flags operation security and server changes as high risk", () => {
    const endpoint: EndpointToolDefinition = {
      kind: "endpoint", name: "list_items", originalOperationId: "list_items", description: "List", method: "GET", path: "/items", parameters: [], tags: [],
      securityRequirements: [{ schemes: [{ scheme: "key", scopes: [] }] }],
    };
    const base = createIR(createWorkflowTool({ name: "unused" }));
    const oldIR: MCPForgeIR = { ...base, tools: [endpoint] };
    const newIR: MCPForgeIR = {
      ...base,
      tools: [{ ...endpoint, baseUrl: "https://regional.example.com", securityRequirements: [] }],
    };
    const result = diffIR(oldIR, newIR);
    expect(result.changes.some((change) => change.details === "Operation server URL changed." && change.risk === "high")).toBe(true);
    expect(result.changes.some((change) => change.details === "Operation security requirements changed." && change.risk === "high")).toBe(true);
  });

  it("flags incompatible response schema changes as high risk", () => {
    const endpoint: EndpointToolDefinition = {
      kind: "endpoint",
      name: "get_item",
      originalOperationId: "get_item",
      description: "Get an item",
      method: "GET",
      path: "/items/{id}",
      parameters: [],
      tags: ["items"],
      response: {
        statusCode: "200",
        contentType: "application/json",
        schema: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
          required: ["id", "name"],
        },
      },
    };
    const base = createIR(createWorkflowTool({ name: "unused" }));
    const oldIR: MCPForgeIR = { ...base, tools: [endpoint] };
    const newIR: MCPForgeIR = {
      ...base,
      tools: [
        {
          ...endpoint,
          response: {
            ...endpoint.response!,
            schema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      ],
    };

    const result = diffIR(oldIR, newIR);

    expect(
      result.changes.some(
        (change) => change.details === "Response schema changed in an incompatible way." && change.risk === "high",
      ),
    ).toBe(true);
  });
});
