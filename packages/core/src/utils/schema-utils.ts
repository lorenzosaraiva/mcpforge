type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

function deepClone<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();

  const clone = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      if (seen.has(input)) {
        return [];
      }
      const output: unknown[] = [];
      seen.set(input, output);
      for (const item of input) {
        output.push(clone(item));
      }
      return output;
    }

    if (!input || typeof input !== "object") {
      return input;
    }

    if (seen.has(input)) {
      return {};
    }

    const output: Record<string, unknown> = {};
    seen.set(input, output);
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      output[key] = clone(item);
    }
    return output;
  };

  return clone(value) as T;
}

function normalizeNode(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeNode(item));
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = normalizeNode(value);
    }
  }

  if (output.nullable === true) {
    delete output.nullable;
    const currentType = output.type;
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

  return output;
}

export function toJsonSchema(schema: unknown): Record<string, unknown> {
  const safeSchema = schema && typeof schema === "object" ? deepClone(schema) : {};
  const normalized = normalizeNode(safeSchema);

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return { type: "object", additionalProperties: true };
  }

  return normalized as Record<string, unknown>;
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
    const firstString = typed.type.find((item): item is string => typeof item === "string");
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
