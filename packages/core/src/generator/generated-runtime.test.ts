import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EndpointToolDefinition, MCPForgeIR } from "../parser/types.js";
import { generateTypeScriptMCPServer } from "./typescript-generator.js";

const tempDirs: string[] = [];

function createIR(
  tool: EndpointToolDefinition,
  auth: MCPForgeIR["auth"],
): MCPForgeIR {
  return {
    apiName: "Runtime Fixture",
    apiDescription: "Generated runtime fixture",
    baseUrl: "https://api.example.com",
    auth,
    tools: [tool],
    rawEndpointCount: 1,
  };
}

async function transpileGeneratedModule(rootDir: string, relativePath: string): Promise<void> {
  const sourcePath = join(rootDir, relativePath);
  const outputPath = join(
    rootDir,
    relativePath.replace(/^src[\\/]/, "").replace(/\.ts$/, ".js"),
  );
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    fileName: sourcePath,
  });
  await writeFile(outputPath, transpiled.outputText, "utf8");
}

async function importRuntimeModules(rootDir: string): Promise<{
  invokeEndpoint: (
    endpoint: Record<string, unknown>,
    input: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<unknown>;
  resolveAuthState: (authConfig: Record<string, unknown>) => { auth: Record<string, unknown> };
  AUTH_CONFIG: Record<string, unknown>;
}> {
  await transpileGeneratedModule(rootDir, join("src", "resilience.ts"));
  await transpileGeneratedModule(rootDir, join("src", "runtime.ts"));

  const runtimeModule = await import(pathToFileURL(join(rootDir, "runtime.js")).href);
  if (!existsSync(join(rootDir, "src", "auth.ts"))) {
    return {
      invokeEndpoint: runtimeModule.invokeEndpoint,
      resolveAuthState: () => ({
        auth: {
          headers: {},
          queryParams: {},
        },
      }),
      AUTH_CONFIG: {
        type: "none",
      },
    };
  }

  await transpileGeneratedModule(rootDir, join("src", "auth.ts"));
  const authModule = await import(pathToFileURL(join(rootDir, "auth.js")).href);
  return {
    invokeEndpoint: runtimeModule.invokeEndpoint,
    resolveAuthState: authModule.resolveAuthState,
    AUTH_CONFIG: authModule.AUTH_CONFIG,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  delete process.env.API_KEY;
});

describe("generated runtime", () => {
  it("injects query api-key auth into outgoing requests", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mcpforge-runtime-"));
    tempDirs.push(outputDir);

    const tool: EndpointToolDefinition = {
      kind: "endpoint",
      name: "list_customers",
      originalOperationId: "list_customers",
      description: "List customers",
      method: "GET",
      path: "/v1/customers",
      parameters: [
        {
          name: "email",
          description: "Email filter",
          type: "string",
          required: false,
          location: "query",
        },
      ],
      tags: ["customers"],
    };

    await generateTypeScriptMCPServer(
      createIR(tool, {
        type: "api-key",
        parameterName: "api_key",
        location: "query",
        envVarName: "API_KEY",
        required: true,
        hasSecuritySchemes: true,
      }),
      {
        outputDir,
        projectName: "runtime-fixture",
      },
    );

    const { invokeEndpoint, resolveAuthState, AUTH_CONFIG } = await importRuntimeModules(outputDir);
    process.env.API_KEY = "secret-token";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(
        JSON.stringify({
          url: requestUrl,
          headers: init?.headers,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeEndpoint(
      {
        name: "list_customers",
        method: "GET",
        path: "/v1/customers",
        pathParams: [],
        hasPathParams: false,
        queryParams: [{ name: "email", required: false }],
        hasQueryParams: true,
        headerParams: [],
        hasHeaderParams: false,
        hasRequestBody: false,
        requestBodyRequired: false,
        requestBodyContentType: "application/json",
      },
      {
        email: "user@example.com",
      },
      {
        baseUrl: "https://api.example.com",
        auth: resolveAuthState(AUTH_CONFIG).auth,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 200,
      data: {
        url: "https://api.example.com/v1/customers?email=user%40example.com&api_key=secret-token",
        headers: {},
      },
    });
  });

  it("serializes x-www-form-urlencoded request bodies", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mcpforge-runtime-"));
    tempDirs.push(outputDir);

    const tool: EndpointToolDefinition = {
      kind: "endpoint",
      name: "create_customer",
      originalOperationId: "create_customer",
      description: "Create customer",
      method: "POST",
      path: "/v1/customers",
      parameters: [],
      requestBody: {
        contentType: "application/x-www-form-urlencoded",
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
            status: { type: "string" },
          },
        },
        required: true,
      },
      tags: ["customers"],
    };

    await generateTypeScriptMCPServer(
      createIR(tool, {
        type: "none",
        envVarName: "NO_AUTH",
        required: false,
        hasSecuritySchemes: false,
      }),
      {
        outputDir,
        projectName: "runtime-fixture",
      },
    );

    const { invokeEndpoint } = await importRuntimeModules(outputDir);

    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          body: init?.body,
          headers: init?.headers,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeEndpoint(
      {
        name: "create_customer",
        method: "POST",
        path: "/v1/customers",
        pathParams: [],
        hasPathParams: false,
        queryParams: [],
        hasQueryParams: false,
        headerParams: [],
        hasHeaderParams: false,
        hasRequestBody: true,
        requestBodyRequired: true,
        requestBodyContentType: "application/x-www-form-urlencoded",
      },
      {
        body: {
          email: "user@example.com",
          status: "active",
        },
      },
      {
        baseUrl: "https://api.example.com",
        auth: {
          headers: {},
          queryParams: {},
        },
      },
    );

    expect(result).toEqual({
      status: 200,
      data: {
        body: "email=user%40example.com&status=active",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    });
  });

  it("serializes multipart form-data bodies without forcing a content-type header", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mcpforge-runtime-"));
    tempDirs.push(outputDir);

    const tool: EndpointToolDefinition = {
      kind: "endpoint",
      name: "upload_asset",
      originalOperationId: "upload_asset",
      description: "Upload asset",
      method: "POST",
      path: "/v1/assets",
      parameters: [],
      requestBody: {
        contentType: "multipart/form-data",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            file: { type: "string", format: "binary" },
          },
        },
        required: true,
      },
      tags: ["assets"],
    };

    await generateTypeScriptMCPServer(
      createIR(tool, {
        type: "none",
        envVarName: "NO_AUTH",
        required: false,
        hasSecuritySchemes: false,
      }),
      {
        outputDir,
        projectName: "runtime-fixture",
      },
    );

    const { invokeEndpoint } = await importRuntimeModules(outputDir);

    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);

      const formData = body as FormData;
      const name = formData.get("name");
      const file = formData.get("file");

      return new Response(
        JSON.stringify({
          name,
          fileName: file instanceof File ? file.name : undefined,
          fileType: file instanceof File ? file.type : undefined,
          headers: init?.headers,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeEndpoint(
      {
        name: "upload_asset",
        method: "POST",
        path: "/v1/assets",
        pathParams: [],
        hasPathParams: false,
        queryParams: [],
        hasQueryParams: false,
        headerParams: [],
        hasHeaderParams: false,
        hasRequestBody: true,
        requestBodyRequired: true,
        requestBodyContentType: "multipart/form-data",
      },
      {
        body: {
          name: "sample",
          file: {
            content: "hello",
            filename: "hello.txt",
            contentType: "text/plain",
          },
        },
      },
      {
        baseUrl: "https://api.example.com",
        auth: {
          headers: {},
          queryParams: {},
        },
      },
    );

    expect(result).toEqual({
      status: 200,
      data: {
        name: "sample",
        fileName: "hello.txt",
        fileType: "text/plain",
        headers: {},
      },
    });
  });
});
