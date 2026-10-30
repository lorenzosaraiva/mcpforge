import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MCPForgeIR, WorkflowToolDefinition } from "../parser/types.js";
import {
  applyReadOnlyPolicy,
  isReadOnlyTool,
  toolAnnotations,
} from "./policy.js";
import { generateTypeScriptMCPServer } from "./typescript-generator.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const ir: MCPForgeIR = {
  apiName: "Policy",
  apiDescription: "policy fixture",
  baseUrl: "https://example.invalid",
  auth: { type: "none", envVarName: "NONE" },
  rawEndpointCount: 2,
  tools: [
    {
      kind: "endpoint",
      name: "list_items",
      originalOperationId: "listItems",
      method: "GET",
      path: "/items",
      parameters: [],
      tags: [],
    },
    {
      kind: "endpoint",
      name: "delete_item",
      originalOperationId: "deleteItem",
      method: "DELETE",
      path: "/items/{id}",
      parameters: [],
      tags: [],
    },
  ],
};
const workflow: WorkflowToolDefinition = {
  kind: "workflow",
  name: "workflow",
  description: "fixture",
  tags: [],
  inputSchema: { type: "object" },
  dependsOnOperationIds: ["listItems"],
  steps: [{ id: "step", operationId: "deleteItem", args: {} }],
};
describe("read-only method policy", () => {
  it("uses actual workflow steps, including hidden dependencies, rather than trusting hints", () => {
    expect(isReadOnlyTool(workflow, ir)).toBe(false);
    expect(
      isReadOnlyTool(
        {
          ...workflow,
          steps: [{ id: "step", operationId: "missing", args: {} }],
        },
        ir,
      ),
    ).toBe(false);
    expect(
      applyReadOnlyPolicy({ ...ir, tools: [...ir.tools, workflow] }).tools.map(
        (tool) => tool.name,
      ),
    ).toEqual(["list_items"]);
    expect(toolAnnotations(workflow, ir)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
  it("omits writes from generated tools and includes a runtime guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcpforge-policy-"));
    dirs.push(dir);
    await generateTypeScriptMCPServer(
      { ...ir, executionPolicy: { readOnly: true } },
      { outputDir: dir, sourceIR: ir },
    );
    const index = await readFile(join(dir, "src", "index.ts"), "utf8");
    expect(index).toContain('name: "list_items"');
    expect(index).not.toContain('name: "delete_item"');
    expect(index).toContain("const READ_ONLY = true");
    expect(await readFile(join(dir, "src", "runtime.ts"), "utf8")).toContain(
      "blocked by the read-only HTTP method policy",
    );
  });
});
