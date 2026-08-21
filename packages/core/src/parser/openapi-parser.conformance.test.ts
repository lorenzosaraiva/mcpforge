import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseOpenAPISpec } from "./openapi-parser.js";

const fixture = (name: string) => resolve(process.cwd(), "packages/core/test/fixtures", name);

describe("OpenAPI parser conformance fixtures", () => {
  it("expands server variables and preserves operation server/security overrides", async () => {
    const ir = await parseOpenAPISpec(fixture("openapi31-mixed-security.yaml"));
    expect(ir.baseUrl).toBe("https://eu.example.com/v1");
    const publicTool = ir.tools.find((tool) => tool.originalOperationId === "getPublic");
    const combined = ir.tools.find((tool) => tool.originalOperationId === "getCombined");
    expect(publicTool?.kind === "endpoint" ? publicTool.securityRequirements : undefined).toEqual([]);
    expect(publicTool?.kind === "endpoint" ? publicTool.response : undefined).toEqual({
      statusCode: "200",
      contentType: "application/json",
      contentTypes: [
        {
          contentType: "application/json",
          schema: {
            type: "object",
            properties: { available: { type: "boolean" } },
            required: ["available"],
          },
        },
        { contentType: "text/plain", schema: { type: "string" } },
      ],
      schema: {
        type: "object",
        properties: { available: { type: "boolean" } },
        required: ["available"],
      },
      description: "Public status",
    });
    expect(combined?.kind === "endpoint" ? combined.baseUrl : undefined).toBe("https://special.example.com/api");
    expect(combined?.kind === "endpoint" ? combined.response : undefined).toBeUndefined();
    expect(combined?.kind === "endpoint" ? combined.securityRequirements : undefined).toEqual([
      { schemes: [{ scheme: "headerKey", scopes: [] }, { scheme: "tenantKey", scopes: [] }] },
    ]);
  });

  it("normalizes Swagger 2 formData, base URL, and missing operation IDs", async () => {
    const ir = await parseOpenAPISpec(fixture("swagger2-form.json"));
    expect(ir.baseUrl).toBe("https://upload.example.com/v2");
    expect(ir.tools).toHaveLength(1);
    const tool = ir.tools[0];
    expect(tool?.name).toBe("post_assets");
    expect(tool?.kind === "endpoint" ? tool.requestBody : undefined).toMatchObject({
      contentType: "multipart/form-data",
      required: true,
      schema: { type: "object", required: ["file"] },
    });
    expect(tool?.kind === "endpoint" ? tool.response : undefined).toMatchObject({
      statusCode: "201",
      contentType: "application/json",
      schema: { type: "object", required: ["id"] },
    });
  });
});
