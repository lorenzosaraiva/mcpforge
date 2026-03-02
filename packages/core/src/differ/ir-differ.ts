import type {
  AuthConfig,
  MCPForgeIR,
  RequestBodyDef,
  ToolDefinition,
  ToolParameter,
} from "../parser/types.js";

export interface DiffResult {
  summary: {
    totalChanges: number;
    high: number;
    medium: number;
    low: number;
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  changes: DiffChange[];
}

export interface DiffChange {
  risk: "high" | "medium" | "low";
  type: "added" | "removed" | "modified";
  toolName: string;
  path: string;
  method: string;
  details: string;
  before?: string;
  after?: string;
}

type MatchedToolPair = {
  oldTool: ToolDefinition;
  newTool: ToolDefinition;
  oldIndex: number;
  newIndex: number;
  matchedBy: "operationId" | "methodPath";
};

const RISK_ORDER: Record<DiffChange["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenizeText(value: string | undefined): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) {
    return new Set<string>();
  }
  return new Set(normalized.split(" ").filter(Boolean));
}

function jaccardSimilarity(a: string | undefined, b: string | undefined): number {
  const setA = tokenizeText(a);
  const setB = tokenizeText(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${pairs.join(",")}}`;
}

function toParamKey(parameter: ToolParameter): string {
  return `${parameter.location}:${parameter.name}`;
}

function toMethodPathKey(tool: ToolDefinition): string {
  return `${tool.method.toUpperCase()} ${tool.path}`;
}

function isDeprecated(tool: ToolDefinition): boolean {
  const text = `${tool.description} ${tool.responseDescription ?? ""}`.toLowerCase();
  return text.includes("deprecated");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function schemaType(schema: Record<string, unknown>): string | undefined {
  const typeValue = schema.type;
  if (typeof typeValue === "string") {
    return typeValue;
  }
  return undefined;
}

function toRequiredSet(schema: Record<string, unknown>): Set<string> {
  const required = schema.required;
  if (!Array.isArray(required)) {
    return new Set<string>();
  }
  return new Set(required.filter((entry): entry is string => typeof entry === "string"));
}

function toPropertyMap(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = asRecord(schema.properties);
  const mapped: Record<string, Record<string, unknown>> = {};

  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    mapped[propertyName] = asRecord(propertySchema);
  }

  return mapped;
}

function requestBodyHasIncompatibleSchemaChange(
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
): boolean {
  const oldType = schemaType(oldSchema);
  const newType = schemaType(newSchema);
  if (oldType && newType && oldType !== newType) {
    return true;
  }

  if (oldType === "object" && newType === "object") {
    const oldProps = toPropertyMap(oldSchema);
    const newProps = toPropertyMap(newSchema);
    const oldRequired = toRequiredSet(oldSchema);
    const newRequired = toRequiredSet(newSchema);

    for (const [propertyName, oldPropSchema] of Object.entries(oldProps)) {
      const newPropSchema = newProps[propertyName];
      if (!newPropSchema) {
        return true;
      }

      const oldPropType = schemaType(oldPropSchema);
      const newPropType = schemaType(newPropSchema);
      if (oldPropType && newPropType && oldPropType !== newPropType) {
        return true;
      }
    }

    for (const requiredProperty of newRequired) {
      if (!oldRequired.has(requiredProperty) && Object.hasOwn(oldProps, requiredProperty)) {
        return true;
      }
    }

    return false;
  }

  const oldSchemaJson = stableStringify(oldSchema);
  const newSchemaJson = stableStringify(newSchema);
  return oldSchemaJson !== newSchemaJson;
}

function addChange(changes: DiffChange[], change: DiffChange): void {
  changes.push(change);
}

function compareAuth(oldAuth: AuthConfig, newAuth: AuthConfig): DiffChange[] {
  const changes: DiffChange[] = [];
  const base = {
    toolName: "auth",
    path: "(global)",
    method: "AUTH",
  };

  if (oldAuth.type !== newAuth.type) {
    addChange(changes, {
      ...base,
      risk: "high",
      type: "modified",
      details: "Authentication scheme changed.",
      before: oldAuth.type,
      after: newAuth.type,
    });
  }

  if ((oldAuth.headerName ?? "") !== (newAuth.headerName ?? "")) {
    addChange(changes, {
      ...base,
      risk: "high",
      type: "modified",
      details: "Authentication header name changed.",
      before: oldAuth.headerName ?? "(none)",
      after: newAuth.headerName ?? "(none)",
    });
  }

  if ((oldAuth.scheme ?? "") !== (newAuth.scheme ?? "")) {
    addChange(changes, {
      ...base,
      risk: "high",
      type: "modified",
      details: "Authentication scheme token changed.",
      before: oldAuth.scheme ?? "(none)",
      after: newAuth.scheme ?? "(none)",
    });
  }

  if ((oldAuth.envVarName ?? "") !== (newAuth.envVarName ?? "")) {
    addChange(changes, {
      ...base,
      risk: "medium",
      type: "modified",
      details: "Authentication environment variable changed.",
      before: oldAuth.envVarName,
      after: newAuth.envVarName,
    });
  }

  const oldRequired = oldAuth.required === true;
  const newRequired = newAuth.required === true;
  if (oldRequired !== newRequired) {
    addChange(changes, {
      ...base,
      risk: newRequired ? "high" : "medium",
      type: "modified",
      details: newRequired
        ? "Authentication changed from optional to required."
        : "Authentication changed from required to optional.",
      before: String(oldRequired),
      after: String(newRequired),
    });
  }

  return changes;
}

function compareParameters(oldTool: ToolDefinition, newTool: ToolDefinition): DiffChange[] {
  const changes: DiffChange[] = [];

  const oldByKey = new Map(oldTool.parameters.map((parameter) => [toParamKey(parameter), parameter]));
  const newByKey = new Map(newTool.parameters.map((parameter) => [toParamKey(parameter), parameter]));
  const oldByName = new Map<string, ToolParameter[]>();
  const newByName = new Map<string, ToolParameter[]>();

  for (const parameter of oldTool.parameters) {
    const current = oldByName.get(parameter.name) ?? [];
    current.push(parameter);
    oldByName.set(parameter.name, current);
  }
  for (const parameter of newTool.parameters) {
    const current = newByName.get(parameter.name) ?? [];
    current.push(parameter);
    newByName.set(parameter.name, current);
  }

  const movedParamNames = new Set<string>();

  for (const oldParameter of oldTool.parameters) {
    const oldKey = toParamKey(oldParameter);
    const matchingNewParameter = newByKey.get(oldKey);
    if (matchingNewParameter) {
      if (oldParameter.type !== matchingNewParameter.type) {
        addChange(changes, {
          risk: "high",
          type: "modified",
          toolName: newTool.name,
          method: newTool.method,
          path: newTool.path,
          details: `Parameter "${oldParameter.name}" type changed.`,
          before: oldParameter.type,
          after: matchingNewParameter.type,
        });
      }

      if (oldParameter.required !== matchingNewParameter.required) {
        addChange(changes, {
          risk: matchingNewParameter.required ? "high" : "medium",
          type: "modified",
          toolName: newTool.name,
          method: newTool.method,
          path: newTool.path,
          details: matchingNewParameter.required
            ? `Parameter "${oldParameter.name}" became required.`
            : `Parameter "${oldParameter.name}" became optional.`,
          before: String(oldParameter.required),
          after: String(matchingNewParameter.required),
        });
      }
      continue;
    }

    const byNameCandidate = (newByName.get(oldParameter.name) ?? [])[0];
    if (byNameCandidate && byNameCandidate.location !== oldParameter.location) {
      movedParamNames.add(oldParameter.name);
      addChange(changes, {
        risk: "high",
        type: "modified",
        toolName: newTool.name,
        method: newTool.method,
        path: newTool.path,
        details: `Parameter "${oldParameter.name}" location changed.`,
        before: oldParameter.location,
        after: byNameCandidate.location,
      });
      continue;
    }

    addChange(changes, {
      risk: oldParameter.required ? "medium" : "medium",
      type: "modified",
      toolName: newTool.name,
      method: newTool.method,
      path: newTool.path,
      details: oldParameter.required
        ? `Required parameter "${oldParameter.name}" was removed.`
        : `Optional parameter "${oldParameter.name}" was removed.`,
      before: JSON.stringify(oldParameter),
    });
  }

  for (const newParameter of newTool.parameters) {
    const newKey = toParamKey(newParameter);
    if (oldByKey.has(newKey) || movedParamNames.has(newParameter.name)) {
      continue;
    }

    addChange(changes, {
      risk: newParameter.required ? "high" : "low",
      type: "modified",
      toolName: newTool.name,
      method: newTool.method,
      path: newTool.path,
      details: newParameter.required
        ? `Required parameter "${newParameter.name}" was added.`
        : `Optional parameter "${newParameter.name}" was added.`,
      after: JSON.stringify(newParameter),
    });
  }

  return changes;
}

function compareRequestBody(
  oldTool: ToolDefinition,
  newTool: ToolDefinition,
): DiffChange[] {
  const changes: DiffChange[] = [];

  const oldBody = oldTool.requestBody;
  const newBody = newTool.requestBody;

  if (!oldBody && !newBody) {
    return changes;
  }

  const toolMeta = {
    toolName: newTool.name,
    method: newTool.method,
    path: newTool.path,
    type: "modified" as const,
  };

  if (!oldBody && newBody) {
    addChange(changes, {
      ...toolMeta,
      risk: newBody.required ? "high" : "low",
      details: newBody.required
        ? "Required request body was added."
        : "Optional request body was added.",
      after: stableStringify(newBody.schema),
    });
    return changes;
  }

  if (oldBody && !newBody) {
    addChange(changes, {
      ...toolMeta,
      risk: oldBody.required ? "medium" : "medium",
      details: oldBody.required
        ? "Required request body was removed."
        : "Optional request body was removed.",
      before: stableStringify(oldBody.schema),
    });
    return changes;
  }

  const resolvedOldBody = oldBody as RequestBodyDef;
  const resolvedNewBody = newBody as RequestBodyDef;

  if (resolvedOldBody.contentType !== resolvedNewBody.contentType) {
    addChange(changes, {
      ...toolMeta,
      risk: "high",
      details: "Request body content type changed.",
      before: resolvedOldBody.contentType,
      after: resolvedNewBody.contentType,
    });
  }

  if (resolvedOldBody.required !== resolvedNewBody.required) {
    addChange(changes, {
      ...toolMeta,
      risk: resolvedNewBody.required ? "high" : "medium",
      details: resolvedNewBody.required
        ? "Request body became required."
        : "Request body became optional.",
      before: String(resolvedOldBody.required),
      after: String(resolvedNewBody.required),
    });
  }

  const oldSchema = resolvedOldBody.schema;
  const newSchema = resolvedNewBody.schema;
  const oldSchemaJson = stableStringify(oldSchema);
  const newSchemaJson = stableStringify(newSchema);
  if (oldSchemaJson !== newSchemaJson) {
    const incompatible = requestBodyHasIncompatibleSchemaChange(oldSchema, newSchema);
    addChange(changes, {
      ...toolMeta,
      risk: incompatible ? "high" : "low",
      details: incompatible
        ? "Request body schema changed in an incompatible way."
        : "Request body schema changed (compatible additions detected).",
      before: oldSchemaJson,
      after: newSchemaJson,
    });
  }

  return changes;
}

function compareToolPair(pair: MatchedToolPair): DiffChange[] {
  const changes: DiffChange[] = [];
  const { oldTool, newTool, matchedBy } = pair;

  if (matchedBy === "operationId" && oldTool.path !== newTool.path) {
    addChange(changes, {
      risk: "high",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details: "Path changed for the same operationId.",
      before: oldTool.path,
      after: newTool.path,
    });
  }

  if (oldTool.method.toUpperCase() !== newTool.method.toUpperCase()) {
    addChange(changes, {
      risk: "high",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details: "HTTP method changed.",
      before: oldTool.method,
      after: newTool.method,
    });
  }

  const oldDescription = normalizeText(oldTool.description);
  const newDescription = normalizeText(newTool.description);
  if (oldDescription !== newDescription) {
    const similarity = jaccardSimilarity(oldTool.description, newTool.description);
    addChange(changes, {
      risk: similarity < 0.55 ? "medium" : "low",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details:
        similarity < 0.55
          ? "Description changed significantly."
          : "Description wording changed.",
      before: oldTool.description,
      after: newTool.description,
    });
  }

  const oldResponseDescription = normalizeText(oldTool.responseDescription);
  const newResponseDescription = normalizeText(newTool.responseDescription);
  if (oldResponseDescription !== newResponseDescription) {
    const responseSimilarity = jaccardSimilarity(
      oldTool.responseDescription,
      newTool.responseDescription,
    );
    addChange(changes, {
      risk: responseSimilarity < 0.55 ? "medium" : "low",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details:
        responseSimilarity < 0.55
          ? "Response description changed significantly."
          : "Response description changed.",
      before: oldTool.responseDescription ?? "(none)",
      after: newTool.responseDescription ?? "(none)",
    });
  }

  if (!isDeprecated(oldTool) && isDeprecated(newTool)) {
    addChange(changes, {
      risk: "medium",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details: "Endpoint is now marked as deprecated.",
      before: "not deprecated",
      after: "deprecated",
    });
  }

  const oldTags = [...oldTool.tags].sort((a, b) => a.localeCompare(b));
  const newTags = [...newTool.tags].sort((a, b) => a.localeCompare(b));
  if (stableStringify(oldTags) !== stableStringify(newTags)) {
    addChange(changes, {
      risk: "low",
      type: "modified",
      toolName: newTool.name,
      path: newTool.path,
      method: newTool.method,
      details: "Tags changed.",
      before: oldTags.join(", ") || "(none)",
      after: newTags.join(", ") || "(none)",
    });
  }

  changes.push(...compareParameters(oldTool, newTool));
  changes.push(...compareRequestBody(oldTool, newTool));

  return changes;
}

function matchTools(oldTools: ToolDefinition[], newTools: ToolDefinition[]): {
  matchedPairs: MatchedToolPair[];
  unmatchedOldIndexes: number[];
  unmatchedNewIndexes: number[];
} {
  const matchedPairs: MatchedToolPair[] = [];
  const usedOldIndexes = new Set<number>();
  const usedNewIndexes = new Set<number>();

  const newByOperationId = new Map<string, number[]>();
  const newByMethodPath = new Map<string, number[]>();

  newTools.forEach((tool, index) => {
    if (tool.originalOperationId) {
      const list = newByOperationId.get(tool.originalOperationId) ?? [];
      list.push(index);
      newByOperationId.set(tool.originalOperationId, list);
    }
    const methodPath = toMethodPathKey(tool);
    const keyList = newByMethodPath.get(methodPath) ?? [];
    keyList.push(index);
    newByMethodPath.set(methodPath, keyList);
  });

  const takeUnusedIndex = (indexes: number[] | undefined, used: Set<number>): number | undefined => {
    if (!indexes) {
      return undefined;
    }
    for (const index of indexes) {
      if (!used.has(index)) {
        return index;
      }
    }
    return undefined;
  };

  oldTools.forEach((oldTool, oldIndex) => {
    if (usedOldIndexes.has(oldIndex)) {
      return;
    }

    let matchedNewIndex: number | undefined;
    let matchedBy: "operationId" | "methodPath" | undefined;

    if (oldTool.originalOperationId) {
      matchedNewIndex = takeUnusedIndex(
        newByOperationId.get(oldTool.originalOperationId),
        usedNewIndexes,
      );
      if (matchedNewIndex !== undefined) {
        matchedBy = "operationId";
      }
    }

    if (matchedNewIndex === undefined) {
      matchedNewIndex = takeUnusedIndex(
        newByMethodPath.get(toMethodPathKey(oldTool)),
        usedNewIndexes,
      );
      if (matchedNewIndex !== undefined) {
        matchedBy = "methodPath";
      }
    }

    if (matchedNewIndex === undefined || !matchedBy) {
      return;
    }

    const newTool = newTools[matchedNewIndex];
    if (!newTool) {
      return;
    }

    usedOldIndexes.add(oldIndex);
    usedNewIndexes.add(matchedNewIndex);
    matchedPairs.push({
      oldTool,
      newTool,
      oldIndex,
      newIndex: matchedNewIndex,
      matchedBy,
    });
  });

  const unmatchedOldIndexes: number[] = [];
  const unmatchedNewIndexes: number[] = [];

  oldTools.forEach((_, index) => {
    if (!usedOldIndexes.has(index)) {
      unmatchedOldIndexes.push(index);
    }
  });
  newTools.forEach((_, index) => {
    if (!usedNewIndexes.has(index)) {
      unmatchedNewIndexes.push(index);
    }
  });

  return {
    matchedPairs,
    unmatchedOldIndexes,
    unmatchedNewIndexes,
  };
}

export function diffIR(oldIR: MCPForgeIR, newIR: MCPForgeIR): DiffResult {
  const changes: DiffChange[] = [];
  const modifiedTools = new Set<string>();

  changes.push(...compareAuth(oldIR.auth, newIR.auth));

  const { matchedPairs, unmatchedOldIndexes, unmatchedNewIndexes } = matchTools(
    oldIR.tools,
    newIR.tools,
  );

  for (const index of unmatchedOldIndexes) {
    const tool = oldIR.tools[index];
    if (!tool) {
      continue;
    }
    addChange(changes, {
      risk: "high",
      type: "removed",
      toolName: tool.name,
      path: tool.path,
      method: tool.method,
      details: "Endpoint was removed entirely.",
      before: `${tool.method} ${tool.path}`,
    });
  }

  for (const index of unmatchedNewIndexes) {
    const tool = newIR.tools[index];
    if (!tool) {
      continue;
    }
    addChange(changes, {
      risk: "low",
      type: "added",
      toolName: tool.name,
      path: tool.path,
      method: tool.method,
      details: "New endpoint was added.",
      after: `${tool.method} ${tool.path}`,
    });
  }

  for (const pair of matchedPairs) {
    const pairChanges = compareToolPair(pair);
    if (pairChanges.length > 0) {
      const key = pair.oldTool.originalOperationId ?? `${pair.oldTool.method} ${pair.oldTool.path}`;
      modifiedTools.add(key);
      changes.push(...pairChanges);
    }
  }

  changes.sort((a, b) => {
    const riskDelta = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
    if (riskDelta !== 0) {
      return riskDelta;
    }
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    const methodDelta = a.method.localeCompare(b.method);
    if (methodDelta !== 0) {
      return methodDelta;
    }
    return a.path.localeCompare(b.path);
  });

  const summary = {
    totalChanges: changes.length,
    high: changes.filter((change) => change.risk === "high").length,
    medium: changes.filter((change) => change.risk === "medium").length,
    low: changes.filter((change) => change.risk === "low").length,
    added: changes.filter((change) => change.type === "added").length,
    removed: changes.filter((change) => change.type === "removed").length,
    modified: modifiedTools.size,
    unchanged: Math.max(matchedPairs.length - modifiedTools.size, 0),
  };

  return {
    summary,
    changes,
  };
}
