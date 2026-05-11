import { afterEach, describe, expect, it } from "vitest";

import type { EndpointToolDefinition, MCPForgeIR } from "../core.js";
import { createCompatibilityHarness } from "./compatibility-runner.js";

const harnesses: Array<Awaited<ReturnType<typeof createCompatibilityHarness>>> = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

function createSourceIR(
  tool: EndpointToolDefinition,
  auth: MCPForgeIR["auth"],
): MCPForgeIR {
  return {
    apiName: "Compatibility Fixture",
    apiDescription: "Compatibility Fixture",
    baseUrl: "https://api.example.com",
    auth,
    tools: [tool],
    rawEndpointCount: 1,
  };
}

describe("compatibility harness", () => {
  it("provides dummy auth env values for query api-key validation", async () => {
    const harness = await createCompatibilityHarness({
      type: "api-key",
      parameterName: "api_key",
      location: "query",
      envVarName: "API_KEY",
      required: true,
      hasSecuritySchemes: true,
    });
    harnesses.push(harness);

    expect(harness.env).toMatchObject({
      API_BASE_URL: harness.baseUrl,
      API_KEY: "compat-token",
    });
  });

  it("provides a mock OAuth token endpoint for OAuth validation", async () => {
    const harness = await createCompatibilityHarness({
      type: "oauth2",
      headerName: "Authorization",
      parameterName: "Authorization",
      location: "header",
      scheme: "Bearer",
      envVarName: "ACCESS_TOKEN",
      required: true,
      hasSecuritySchemes: true,
      oauthFlow: "clientCredentials",
      tokenUrl: "https://auth.example.com/oauth/token",
      scopes: ["customers:read"],
    });
    harnesses.push(harness);

    expect(harness.env).toMatchObject({
      API_BASE_URL: harness.baseUrl,
      OAUTH_TOKEN_URL: `${harness.baseUrl}/__oauth/token`,
      OAUTH_CLIENT_ID: "compat-client-id",
      OAUTH_CLIENT_SECRET: "compat-client-secret",
    });

    const response = await fetch(harness.env.OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    await expect(response.json()).resolves.toMatchObject({
      access_token: "compat-oauth-token",
      token_type: "Bearer",
    });
  });

  it("accepts a matching request and marks the expectation complete", async () => {
    const tool: EndpointToolDefinition = {
      kind: "endpoint",
      name: "create_customer",
      originalOperationId: "create_customer",
      description: "Create customer",
      method: "POST",
      path: "/customers",
      parameters: [],
      requestBody: {
        contentType: "application/json",
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
          },
          required: ["email"],
        },
        required: true,
      },
      tags: ["customers"],
    };

    const sourceIR = createSourceIR(tool, {
      type: "api-key",
      headerName: "X-API-Key",
      parameterName: "X-API-Key",
      location: "header",
      envVarName: "API_KEY",
      required: true,
      hasSecuritySchemes: true,
    });

    const harness = await createCompatibilityHarness(sourceIR.auth);
    harnesses.push(harness);
    harness.prepare(
      tool,
      {
        body: {
          email: "user@example.com",
        },
      },
      sourceIR,
    );

    const response = await fetch(`${harness.baseUrl}/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "compat-token",
      },
      body: JSON.stringify({
        email: "user@example.com",
      }),
    });

    expect(response.ok).toBe(true);
    expect(harness.finish()).toBeUndefined();
  });
});
