import { describe, expect, it } from "vitest";

import type { MCPForgeIR, WorkflowToolDefinition } from "../parser/types.js";
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
});
