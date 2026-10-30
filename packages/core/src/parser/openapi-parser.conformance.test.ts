import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { parseOpenAPISpec } from "./openapi-parser.js";

const fixture = (name: string) =>
  resolve(process.cwd(), "packages/core/test/fixtures", name);

describe("OpenAPI parser conformance fixtures", () => {
  it("omits closed empty optional GET bodies while retaining actual body declarations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpforge-get-body-"));
    try {
      const operation = (schema: object) => ({
        requestBody: {
          required: false,
          content: {
            "application/x-www-form-urlencoded": { schema },
          },
        },
        responses: { "200": { description: "ok" } },
      });
      const path = join(directory, "spec.json");
      await writeFile(
        path,
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "body", version: "1" },
          paths: {
            "/empty": {
              get: operation({
                type: "object",
                properties: {},
                additionalProperties: false,
              }),
            },
            "/actual": {
              get: operation({
                type: "object",
                properties: { query: { type: "string" } },
              }),
            },
          },
        }),
      );
      const ir = await parseOpenAPISpec(path);
      expect(
        ir.tools.find(
          (tool) => tool.kind === "endpoint" && tool.path === "/empty",
        ),
      ).toHaveProperty("requestBody", undefined);
      expect(
        ir.tools.find(
          (tool) => tool.kind === "endpoint" && tool.path === "/actual",
        ),
      ).toHaveProperty("requestBody.schema.properties.query");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("expands server variables and preserves operation server/security overrides", async () => {
    const ir = await parseOpenAPISpec(fixture("openapi31-mixed-security.yaml"));
    expect(ir.baseUrl).toBe("https://eu.example.com/v1");
    const publicTool = ir.tools.find(
      (tool) => tool.originalOperationId === "getPublic",
    );
    const combined = ir.tools.find(
      (tool) => tool.originalOperationId === "getCombined",
    );
    expect(
      publicTool?.kind === "endpoint"
        ? publicTool.securityRequirements
        : undefined,
    ).toEqual([]);
    expect(
      publicTool?.kind === "endpoint" ? publicTool.response : undefined,
    ).toEqual({
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
    expect(combined?.kind === "endpoint" ? combined.baseUrl : undefined).toBe(
      "https://special.example.com/api",
    );
    expect(
      combined?.kind === "endpoint" ? combined.response : undefined,
    ).toBeUndefined();
    expect(
      combined?.kind === "endpoint" ? combined.securityRequirements : undefined,
    ).toEqual([
      {
        schemes: [
          { scheme: "headerKey", scopes: [] },
          { scheme: "tenantKey", scopes: [] },
        ],
      },
    ]);
  });

  it("normalizes Swagger 2 formData, base URL, and missing operation IDs", async () => {
    const ir = await parseOpenAPISpec(fixture("swagger2-form.json"));
    expect(ir.baseUrl).toBe("https://upload.example.com/v2");
    expect(ir.tools).toHaveLength(1);
    const tool = ir.tools[0];
    expect(tool?.name).toBe("post_assets");
    expect(
      tool?.kind === "endpoint" ? tool.requestBody : undefined,
    ).toMatchObject({
      contentType: "multipart/form-data",
      required: true,
      schema: { type: "object", required: ["file"] },
    });
    expect(tool?.kind === "endpoint" ? tool.response : undefined).toMatchObject(
      {
        statusCode: "201",
        contentType: "application/json",
        schema: { type: "object", required: ["id"] },
      },
    );
  });
});
