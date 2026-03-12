import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EndpointToolDefinition, MCPForgeIR } from "../parser/types.js";
import { planWorkflowTools } from "../planner/workflow-planner.js";
import { generateTypeScriptMCPServer } from "./typescript-generator.js";

const tempDirs: string[] = [];

function createEndpointTool(
  overrides: Partial<EndpointToolDefinition> & Pick<EndpointToolDefinition, "name" | "method" | "path">,
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generateTypeScriptMCPServer", () => {
  it("writes workflow runtime and handler files", async () => {
    const sourceIR = createIR([
      createEndpointTool({
        name: "list_customers",
        originalOperationId: "list_customers",
        method: "GET",
        path: "/v1/customers",
        parameters: [
          {
            name: "email",
            description: "Filter by email",
            type: "string",
            required: false,
            location: "query",
          },
        ],
      }),
    ]);

    const finalIR = planWorkflowTools(sourceIR, {
      includeEndpointFallback: false,
      maxTools: 3,
    });

    const outputDir = await mkdtemp(join(tmpdir(), "mcpforge-generator-"));
    tempDirs.push(outputDir);

    await generateTypeScriptMCPServer(finalIR, {
      outputDir,
      projectName: "mcp-server-test",
      sourceIR,
    });

    const runtimeContent = await readFile(join(outputDir, "src", "runtime.ts"), "utf8");
    const handlerContent = await readFile(join(outputDir, "src", "tools", "find_customers.ts"), "utf8");

    expect(runtimeContent).toContain("export async function invokeEndpoint");
    expect(handlerContent).toContain("selectWorkflowOutput");
    expect(handlerContent).toContain("WORKFLOW_STEPS");
  });
});
