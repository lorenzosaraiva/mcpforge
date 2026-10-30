import { describe, expect, it } from "vitest";
import type { MCPForgeIR } from "../core.js";
import { credentialRequirements, credentialsPresent } from "./project-auth.js";

const ir: MCPForgeIR = {
  irVersion: 2,
  apiName: "auth",
  apiDescription: "auth",
  baseUrl: "https://example.invalid",
  rawEndpointCount: 1,
  auth: { type: "bearer", envVarName: "TOKEN" },
  securitySchemes: {
    token: { type: "bearer", envVarName: "TOKEN" },
    key: { type: "api-key", envVarName: "KEY" },
    tenant: { type: "api-key", envVarName: "TENANT" },
  },
  tools: [
    {
      kind: "endpoint",
      name: "read",
      method: "GET",
      path: "/",
      parameters: [],
      tags: [],
      securityRequirements: [
        {
          schemes: [
            { scheme: "key", scopes: [] },
            { scheme: "tenant", scopes: [] },
          ],
        },
        { schemes: [{ scheme: "token", scopes: [] }] },
      ],
    },
  ],
};
describe("selected operation credentials", () => {
  it("prompts for one permitted alternative and checks OR/AND requirements", () => {
    expect(credentialRequirements(ir).map((item) => item.name)).toEqual([
      "TOKEN",
    ]);
    expect(credentialsPresent(ir, ir, { KEY: "synthetic" })).toBe(false);
    expect(
      credentialsPresent(ir, ir, { KEY: "synthetic", TENANT: "synthetic" }),
    ).toBe(true);
    expect(credentialsPresent(ir, ir, { TOKEN: "synthetic" })).toBe(true);
  });
  it("does not request unused global credentials for public operations", () => {
    const publicIR = {
      ...ir,
      tools: ir.tools.map((tool) => ({ ...tool, securityRequirements: [] })),
    };
    expect(credentialRequirements(publicIR)).toEqual([]);
    expect(credentialsPresent(publicIR, publicIR, {})).toBe(true);
  });
  it("resolves workflow authentication against source endpoints", () => {
    const workflowIR: MCPForgeIR = {
      ...ir,
      tools: [
        {
          kind: "workflow",
          name: "task",
          description: "read",
          tags: [],
          inputSchema: { type: "object" },
          dependsOnOperationIds: ["read"],
          steps: [{ id: "one", operationId: "read", args: {} }],
        },
      ],
    };
    expect(
      credentialRequirements(workflowIR, ir).map((item) => item.name),
    ).toEqual(["TOKEN"]);
    expect(credentialsPresent(workflowIR, ir, { TOKEN: "synthetic" })).toBe(
      true,
    );
  });
});
