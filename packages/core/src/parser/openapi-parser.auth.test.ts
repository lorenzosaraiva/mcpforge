import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseOpenAPISpec } from "./openapi-parser.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeSpec(document: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcpforge-openapi-auth-"));
  tempDirs.push(dir);
  const specPath = join(dir, "openapi.json");
  await writeFile(specPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return specPath;
}

function createSpec(
  securityScheme: Record<string, unknown>,
  requirement: Record<string, unknown>,
): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Auth Fixture",
      version: "1.0.0",
    },
    servers: [{ url: "https://api.example.com" }],
    components: {
      securitySchemes: {
        primaryAuth: securityScheme,
      },
    },
    security: [requirement],
    paths: {
      "/customers": {
        get: {
          operationId: "listCustomers",
          summary: "List customers",
          responses: {
            200: {
              description: "Customer list",
            },
          },
        },
      },
    },
  };
}

describe("parseOpenAPISpec auth detection", () => {
  it("preserves header api-key location metadata", async () => {
    const specPath = await writeSpec(
      createSpec(
        {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
        { primaryAuth: [] },
      ),
    );

    const result = await parseOpenAPISpec(specPath);

    expect(result.auth).toMatchObject({
      type: "api-key",
      location: "header",
      parameterName: "X-API-Key",
      headerName: "X-API-Key",
      required: true,
    });
  });

  it("preserves query api-key location metadata", async () => {
    const specPath = await writeSpec(
      createSpec(
        {
          type: "apiKey",
          in: "query",
          name: "api_key",
        },
        { primaryAuth: [] },
      ),
    );

    const result = await parseOpenAPISpec(specPath);

    expect(result.auth).toMatchObject({
      type: "api-key",
      location: "query",
      parameterName: "api_key",
      headerName: undefined,
      required: true,
    });
  });

  it("preserves cookie api-key location metadata", async () => {
    const specPath = await writeSpec(
      createSpec(
        {
          type: "apiKey",
          in: "cookie",
          name: "session",
        },
        { primaryAuth: [] },
      ),
    );

    const result = await parseOpenAPISpec(specPath);

    expect(result.auth).toMatchObject({
      type: "api-key",
      location: "cookie",
      parameterName: "session",
      headerName: undefined,
      required: true,
    });
  });

  it("preserves OAuth client credentials token metadata", async () => {
    const specPath = await writeSpec(
      createSpec(
        {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: "https://auth.example.com/oauth/token",
              scopes: {
                "customers:read": "Read customers",
                "customers:write": "Write customers",
              },
            },
          },
        },
        { primaryAuth: ["customers:read"] },
      ),
    );

    const result = await parseOpenAPISpec(specPath);

    expect(result.auth).toMatchObject({
      type: "oauth2",
      oauthFlow: "clientCredentials",
      tokenUrl: "https://auth.example.com/oauth/token",
      scopes: ["customers:read", "customers:write"],
      oauthFlows: [
        {
          type: "clientCredentials",
          tokenUrl: "https://auth.example.com/oauth/token",
          scopes: ["customers:read", "customers:write"],
          supported: true,
        },
      ],
    });
  });

  it("preserves public overrides, OR alternatives, AND schemes, and operation scopes", async () => {
    const specPath = await writeSpec({
      openapi: "3.1.0",
      info: { title: "Mixed Security", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      components: {
        securitySchemes: {
          headerKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          tenantKey: { type: "apiKey", in: "query", name: "tenant_key" },
          oauth: {
            type: "oauth2",
            flows: { clientCredentials: { tokenUrl: "https://auth.example.com/token", scopes: { read: "Read" } } },
          },
        },
      },
      security: [{ headerKey: [] }],
      paths: {
        "/public": { get: { operationId: "getPublic", security: [], responses: { "200": { description: "ok" } } } },
        "/alternative": { get: { operationId: "getAlternative", security: [{ headerKey: [] }, { oauth: ["read"] }], responses: { "200": { description: "ok" } } } },
        "/combined": { get: { operationId: "getCombined", security: [{ headerKey: [], tenantKey: [] }], responses: { "200": { description: "ok" } } } },
      },
    });

    const result = await parseOpenAPISpec(specPath);
    const byId = new Map(
      result.tools
        .filter((tool) => tool.kind === "endpoint")
        .map((tool) => [tool.originalOperationId, tool]),
    );
    expect(result.irVersion).toBe(2);
    expect(Object.keys(result.securitySchemes ?? {})).toEqual(["headerKey", "tenantKey", "oauth"]);
    expect(byId.get("getPublic")?.securityRequirements).toEqual([]);
    expect(byId.get("getAlternative")?.securityRequirements).toEqual([
      { schemes: [{ scheme: "headerKey", scopes: [] }] },
      { schemes: [{ scheme: "oauth", scopes: ["read"] }] },
    ]);
    expect(byId.get("getCombined")?.securityRequirements).toEqual([
      { schemes: [{ scheme: "headerKey", scopes: [] }, { scheme: "tenantKey", scopes: [] }] },
    ]);
    expect(result.securitySchemes?.headerKey?.envVarName).toBe("HEADER_KEY_CREDENTIAL");
    expect(result.securitySchemes?.tenantKey?.envVarName).toBe("TENANT_KEY_CREDENTIAL");
  });
});
