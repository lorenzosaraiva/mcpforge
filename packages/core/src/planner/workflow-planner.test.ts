import { describe, expect, it } from "vitest";

import type { EndpointToolDefinition, MCPForgeIR } from "../parser/types.js";
import { planWorkflowTools } from "./workflow-planner.js";

function createEndpointTool(
  overrides: Partial<EndpointToolDefinition> &
    Pick<EndpointToolDefinition, "name" | "method" | "path">,
): EndpointToolDefinition {
  return {
    kind: "endpoint",
    description: `${overrides.method} ${overrides.path}`,
    parameters: [],
    tags: ["customers"],
    ...overrides,
  };
}

function createIR(tools: EndpointToolDefinition[]): MCPForgeIR {
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

describe("planWorkflowTools", () => {
  it("distinguishes nested resources sharing a broad upstream tag", () => {
    const source = createIR(
      ["commits", "branches", "contributors"].map((resource) =>
        createEndpointTool({
          name: `list_${resource}`,
          originalOperationId: `list_${resource}`,
          method: "GET",
          path: `/repos/{owner}/{repo}/${resource}`,
          tags: ["repos"],
          description: `List repository ${resource}`,
        }),
      ),
    );
    const planned = planWorkflowTools(source, {
      maxTools: 3,
      includeEndpointFallback: false,
      logger: () => {},
    });
    expect(planned.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "find_commits",
        "find_branches",
        "find_contributors",
      ]),
    );
    expect(
      planned.tools.find((tool) => tool.name === "find_commits")?.description,
    ).toContain("List repository commits");
  });
  it("promotes curated endpoint shapes into workflow tools", () => {
    const sourceIR = createIR([
      createEndpointTool({
        name: "list_customers",
        originalOperationId: "list_customers",
        method: "GET",
        path: "/v1/customers",
        description: "List customers",
        parameters: [
          {
            name: "email",
            description: "Filter by email",
            type: "string",
            required: false,
            location: "query",
          },
          {
            name: "limit",
            description: "Page size",
            type: "integer",
            required: false,
            location: "query",
            default: 10,
          },
        ],
      }),
      createEndpointTool({
        name: "get_customer",
        originalOperationId: "get_customer",
        method: "GET",
        path: "/v1/customers/{customer_id}",
        description: "Get a customer",
        parameters: [
          {
            name: "customer_id",
            description: "Customer ID",
            type: "string",
            required: true,
            location: "path",
          },
        ],
      }),
      createEndpointTool({
        name: "create_customer",
        originalOperationId: "create_customer",
        method: "POST",
        path: "/v1/customers",
        description: "Create a customer",
        requestBody: {
          contentType: "application/json",
          required: true,
          schema: {
            type: "object",
            properties: {
              email: { type: "string" },
            },
            required: ["email"],
          },
        },
      }),
    ]);

    const planned = planWorkflowTools(sourceIR, {
      includeEndpointFallback: false,
      maxTools: 5,
      preferredOperationIds: [
        "list_customers",
        "get_customer",
        "create_customer",
      ],
    });

    expect(planned.tools.every((tool) => tool.kind === "workflow")).toBe(true);
    expect(planned.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "find_customers",
        "get_customer",
        "create_customer",
      ]),
    );
    const findCustomers = planned.tools.find(
      (tool) => tool.name === "find_customers",
    );
    expect(findCustomers?.kind).toBe("workflow");
    if (findCustomers?.kind === "workflow") {
      expect(findCustomers.dependsOnOperationIds).toEqual(["list_customers"]);
      expect(findCustomers.inputSchema).toMatchObject({
        type: "object",
        properties: {
          email: { type: "string" },
        },
      });
    }
  });
});
