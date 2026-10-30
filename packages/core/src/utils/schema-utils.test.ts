import { describe, expect, it } from "vitest";
import { toJsonSchema, toStructuredOutputSchema } from "./schema-utils.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";

describe("schema normalization", () => {
  it("preserves shared dereferenced schemas instead of treating sibling references as cycles", () => {
    const user = {
      type: "object",
      properties: { login: { type: "string" } },
      required: ["login"],
    };
    const empty = {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    const schema = {
      type: "object",
      properties: { author: user, committer: { oneOf: [user, empty] } },
    };
    expect(toJsonSchema(schema)).toMatchObject({
      properties: {
        author: user,
        committer: { oneOf: [{ $ref: "#/properties/author" }, empty] },
      },
    });
  });
  it("bounds genuine cycles and retains nullability on composed schemas", () => {
    const cyclic: Record<string, unknown> = { type: "object", properties: {} };
    cyclic.properties = { self: cyclic };
    expect(() => JSON.stringify(toJsonSchema(cyclic))).not.toThrow();
    expect(
      toJsonSchema({
        nullable: true,
        oneOf: [{ type: "string" }, { type: "integer" }],
      }),
    ).toEqual({
      anyOf: [
        { oneOf: [{ type: "string" }, { type: "integer" }] },
        { type: "null" },
      ],
    });
  });
  it("keeps shared schema graphs bounded instead of expanding exponentially", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 40; index++)
      schema = { type: "object", properties: { left: schema, right: schema } };
    expect(JSON.stringify(toJsonSchema(schema)).length).toBeLessThan(100_000);
  });
  it("rebases shared references when a response is wrapped as MCP structured output", () => {
    const user = {
      type: "object",
      properties: { login: { type: "string" } },
      required: ["login"],
      additionalProperties: false,
    };
    const schema = toStructuredOutputSchema({
      statusCode: "200",
      contentType: "application/json",
      schema: {
        type: "object",
        properties: { author: user, committer: user },
        required: ["author", "committer"],
      },
    })!;
    const validate = new AjvJsonSchemaValidator().getValidator(schema);
    expect(
      validate({
        status: 200,
        data: { author: { login: "alice" }, committer: { login: "bob" } },
      }).valid,
    ).toBe(true);
    expect(
      validate({
        status: 200,
        data: { author: { login: "alice" }, committer: {} },
      }).valid,
    ).toBe(false);
  });
});
