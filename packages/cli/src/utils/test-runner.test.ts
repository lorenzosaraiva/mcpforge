import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  toStructuredOutputSchema,
  type EndpointToolDefinition,
} from "../core.js";
import { runRegistrationTests, sampleValueFromSchema } from "./test-runner.js";

describe("compatibility response samples", () => {
  it("honors literal anchored URL path patterns in provider list responses", () => {
    expect(
      sampleValueFromSchema(
        { type: "string", pattern: "^/v1/customers" },
        "url",
      ),
    ).toBe("/v1/customers");
    expect(
      sampleValueFromSchema(
        { type: "string", pattern: "^/v1/invoices$" },
        "url",
      ),
    ).toBe("/v1/invoices");
  });
  it("honors enum constraints before nullable type hints", () => {
    expect(
      sampleValueFromSchema({
        type: ["string", "null"],
        enum: ["completed", "not_planned"],
      }),
    ).toBe("completed");
  });
  it("supplies required fields without explicit property schemas and follows local references", () => {
    const schema = {
      type: "object",
      properties: {
        first: { type: "string", enum: ["expected"] },
        second: { $ref: "#/properties/first" },
      },
      required: ["first", "second", "unspecified"],
    };
    expect(
      sampleValueFromSchema(schema, undefined, {
        includeOptionalObjectProperties: true,
      }),
    ).toMatchObject({
      first: "expected",
      second: "expected",
      unspecified: expect.any(String),
    });
  });
});

function createTool(): EndpointToolDefinition {
  return {
    kind: "endpoint",
    name: "get_customer",
    description: "Get a customer",
    method: "GET",
    path: "/customers/{id}",
    parameters: [],
    tags: ["customers"],
    response: {
      statusCode: "200",
      contentType: "application/json",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
        },
        required: ["id"],
      },
    },
  };
}

function createClient(
  tool: EndpointToolDefinition,
  outputSchema: Record<string, unknown> | undefined,
): Client {
  return {
    listTools: vi.fn(async () => ({
      tools: [
        {
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: "object" as const,
            properties: {},
            additionalProperties: false,
          },
          outputSchema,
        },
      ],
    })),
  } as unknown as Client;
}

describe("runRegistrationTests", () => {
  it("accepts the structured output schema derived from the response contract", async () => {
    const tool = createTool();
    const results = await runRegistrationTests(
      createClient(tool, toStructuredOutputSchema(tool.response)),
      [tool],
    );

    expect(results).toEqual([
      expect.objectContaining({
        toolName: "get_customer",
        status: "pass",
        message: "registered",
      }),
    ]);
  });

  it("reports a missing structured output schema", async () => {
    const tool = createTool();
    const results = await runRegistrationTests(createClient(tool, undefined), [
      tool,
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        toolName: "get_customer",
        status: "fail",
        message: "output schema mismatch",
      }),
    ]);
  });
});
