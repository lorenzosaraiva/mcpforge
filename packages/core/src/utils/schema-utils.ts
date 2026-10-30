import type { ResponseDef } from "../parser/types.js";

type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

function deepClone<T>(value: T): T {
  const targets = new WeakMap<object, string>();
  const active = new WeakSet<object>();
  const maps = new Set([
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
  ]);
  const arrays = new Set(["oneOf", "anyOf", "allOf", "prefixItems"]);
  const singles = new Set([
    "items",
    "additionalProperties",
    "unevaluatedProperties",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "propertyNames",
  ]);
  const token = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
  const clone = (input: unknown, pointer: string, schema: boolean): unknown => {
    if (!input || typeof input !== "object") return input;
    if (schema && !Array.isArray(input) && targets.has(input))
      return { $ref: targets.get(input) };
    if (active.has(input)) return Array.isArray(input) ? [] : {};
    if (schema && !Array.isArray(input)) targets.set(input, pointer);
    active.add(input);
    let output: unknown;
    if (Array.isArray(input))
      output = input.map((item, index) =>
        clone(item, `${pointer}/${index}`, schema),
      );
    else {
      const record: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) {
        const path = `${pointer}/${token(key)}`;
        if (
          maps.has(key) &&
          item &&
          typeof item === "object" &&
          !Array.isArray(item)
        ) {
          record[key] = Object.fromEntries(
            Object.entries(item).map(([name, child]) => [
              name,
              clone(child, `${path}/${token(name)}`, true),
            ]),
          );
        } else
          record[key] = clone(item, path, arrays.has(key) || singles.has(key));
      }
      output = record;
    }
    active.delete(input);
    return output;
  };
  return clone(value, "#", true) as T;
}

function normalizeNode(
  input: unknown,
  memo = new WeakMap<object, unknown>(),
): unknown {
  if (Array.isArray(input)) {
    if (memo.has(input)) return memo.get(input);
    const output: unknown[] = [];
    memo.set(input, output);
    for (const item of input) output.push(normalizeNode(item, memo));
    return output;
  }

  if (!input || typeof input !== "object") {
    return input;
  }
  if (memo.has(input)) return memo.get(input);
  const original = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const inferredType =
    original.type ??
    (original.properties ? "object" : original.items ? "array" : undefined);
  const wrapped = original.nullable === true && !inferredType;
  const result = wrapped ? { anyOf: [output, { type: "null" }] } : output;
  memo.set(input, result);
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = normalizeNode(value, memo);
    }
  }

  if (output.nullable === true) {
    delete output.nullable;
    const currentType = output.type ?? inferredType;
    if (typeof currentType === "string") {
      output.type = [currentType, "null"];
    } else if (Array.isArray(currentType) && !currentType.includes("null")) {
      output.type = [...currentType, "null"];
    }
  }

  if (!output.type) {
    if (output.properties && typeof output.properties === "object") {
      output.type = "object";
    } else if (output.items) {
      output.type = "array";
    } else if (Array.isArray(output.enum) && output.enum.length > 0) {
      const first = output.enum[0];
      if (typeof first === "string") {
        output.type = "string";
      } else if (typeof first === "number") {
        output.type = "number";
      } else if (typeof first === "boolean") {
        output.type = "boolean";
      }
    }
  }

  return result;
}

export function toJsonSchema(schema: unknown): Record<string, unknown> {
  const safeSchema = schema && typeof schema === "object" ? schema : {};
  const normalized = deepClone(normalizeNode(safeSchema));

  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    return { type: "object", additionalProperties: true };
  }

  return normalized as Record<string, unknown>;
}

/** Local JSON pointers are relative to a schema root; embedding requires rebasing them. */
export function rebaseJsonSchema(
  schema: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "$ref" &&
        typeof item === "string" &&
        (item === "#" || item.startsWith("#/"))
          ? `${prefix}${item.slice(1)}`
          : visit(item),
      ]),
    );
  };
  return visit(schema) as Record<string, unknown>;
}

export function toStructuredOutputSchema(
  response: ResponseDef | undefined,
): Record<string, unknown> | undefined {
  if (!response) {
    return undefined;
  }

  const contentSchemas =
    response.contentTypes
      ?.map((entry) => toJsonSchema(entry.schema))
      .filter((schema) => Object.keys(schema).length > 0) ?? [];
  const dataSchema =
    contentSchemas.length > 1
      ? {
          anyOf: contentSchemas.map((schema, index) =>
            rebaseJsonSchema(schema, `#/properties/data/anyOf/${index}`),
          ),
        }
      : rebaseJsonSchema(
          contentSchemas[0] ?? toJsonSchema(response.schema),
          "#/properties/data",
        );

  return {
    type: "object",
    properties: {
      status: {
        type: "integer",
        description: "HTTP response status.",
      },
      data: dataSchema,
    },
    required: ["status", "data"],
    additionalProperties: false,
  };
}

export function inferSchemaType(schema: unknown): string {
  if (!schema || typeof schema !== "object") {
    return "string";
  }

  const typed = schema as Record<string, unknown>;
  if (typeof typed.type === "string") {
    return typed.type;
  }

  if (Array.isArray(typed.type) && typed.type.length > 0) {
    const firstString = typed.type.find(
      (item): item is string => typeof item === "string",
    );
    if (firstString) {
      return firstString;
    }
  }

  if (Array.isArray(typed.enum) && typed.enum.length > 0) {
    const first = typed.enum[0];
    if (typeof first === "string") {
      return "string";
    }
    if (typeof first === "number") {
      return "number";
    }
    if (typeof first === "boolean") {
      return "boolean";
    }
  }

  if (typed.properties && typeof typed.properties === "object") {
    return "object";
  }

  if (typed.items) {
    return "array";
  }

  return "string";
}

export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .toLowerCase();
}

export function toKebabCase(value: string): string {
  return toSnakeCase(value).replace(/_/g, "-");
}

export function truncateText(value: string, maxLength = 240): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  const truncated = clean.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace < 40) {
    return `${truncated}...`;
  }
  return `${truncated.slice(0, lastSpace)}...`;
}

export function asJson(value: unknown): JsonValue {
  return deepClone(value) as JsonValue;
}
