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
});
