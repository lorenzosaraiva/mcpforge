import type {
  EndpointToolDefinition,
  MCPForgeIR,
  ToolDefinition,
  ToolParameter,
  WorkflowStepDefinition,
  WorkflowToolDefinition,
} from "../parser/types.js";
import { toJsonSchema, toSnakeCase, truncateText } from "../utils/schema-utils.js";

export interface WorkflowPlanningOptions {
  maxTools?: number;
  maxWorkflows?: number;
  minWorkflowCount?: number;
  includeEndpointFallback?: boolean;
  preferredOperationIds?: readonly string[];
  logger?: (message: string) => void;
}

interface ResourceInfo {
  singular: string;
  plural: string;
  humanSingular: string;
  humanPlural: string;
}

interface WorkflowCandidate {
  workflow: WorkflowToolDefinition;
  score: number;
}

const NOISE_HINTS = [
  "health",
  "status",
  "metrics",
  "internal",
  "admin",
  "openapi",
  "swagger",
  "schema",
  "docs",
  "ping",
];

const USEFUL_QUERY_PARAMS = [
  "query",
  "q",
  "search",
  "email",
  "name",
  "username",
  "slug",
  "status",
  "type",
  "limit",
  "page",
  "cursor",
  "after",
  "before",
  "sort",
];

const CUSTOM_ACTION_VERBS = [
  "refund",
  "capture",
  "cancel",
  "archive",
  "approve",
  "merge",
  "invite",
  "publish",
  "retry",
  "sync",
  "send",
  "resend",
  "close",
  "open",
  "disable",
  "enable",
  "attach",
  "detach",
  "confirm",
];

function defaultLogger(): void {
  // no-op
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function humanizeSnake(value: string): string {
  return value.replace(/_/g, " ").trim();
}

function singularize(value: string): string {
  if (value.endsWith("ies") && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("sses") || value.endsWith("xes")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 1) {
    return value.slice(0, -1);
  }
  return value;
}

function pluralize(value: string): string {
  if (value.endsWith("y") && value.length > 1) {
    return `${value.slice(0, -1)}ies`;
  }
  if (value.endsWith("s")) {
    return value;
  }
  return `${value}s`;
}

function getPathSegments(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isParameterSegment(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

function isVersionSegment(segment: string): boolean {
  return /^v\d+$/i.test(segment);
}

function toResourceKey(value: string): string {
  return toSnakeCase(value.replace(/[{}]/g, "")).replace(/^v\d+_/, "");
}

function resolveResourceInfo(tool: EndpointToolDefinition): ResourceInfo {
  const primaryTag = tool.tags[0]?.trim();
  if (primaryTag) {
    const tagKey = toResourceKey(primaryTag);
    const singular = singularize(tagKey);
    const plural = pluralize(singular);
    return {
      singular,
      plural,
      humanSingular: humanizeSnake(singular),
      humanPlural: humanizeSnake(plural),
    };
  }

  const segments = getPathSegments(tool.path);
  const plainSegments = segments.filter(
    (segment) => !isParameterSegment(segment) && !isVersionSegment(segment),
  );
  const lastSegment = plainSegments[plainSegments.length - 1] ?? "resource";
  const previousSegment = plainSegments[plainSegments.length - 2] ?? lastSegment;
  const trailingParameter = segments.length > 0 && isParameterSegment(segments[segments.length - 1] ?? "");
  const customAction = !trailingParameter && plainSegments.length >= 2 ? previousSegment : lastSegment;
  const resourceKey = toResourceKey(customAction || "resource");
  const singular = singularize(resourceKey || "resource");
  const plural = pluralize(singular);

  return {
    singular,
    plural,
    humanSingular: humanizeSnake(singular),
    humanPlural: humanizeSnake(plural),
  };
}

function hasTrailingPathParam(tool: EndpointToolDefinition): boolean {
  const segments = getPathSegments(tool.path);
  return segments.length > 0 && isParameterSegment(segments[segments.length - 1] ?? "");
}

function lastPlainPathSegment(tool: EndpointToolDefinition): string | undefined {
  const segments = getPathSegments(tool.path);
  return [...segments]
    .reverse()
    .find((segment) => !isParameterSegment(segment) && !isVersionSegment(segment));
}

function extractSemanticVerb(tool: EndpointToolDefinition): string | undefined {
  const operationIdTokens = toSnakeCase(tool.originalOperationId ?? tool.name)
    .split("_")
    .filter(Boolean);
  const pathVerb = toResourceKey(lastPlainPathSegment(tool) ?? "");
  const candidates = [pathVerb, operationIdTokens[0] ?? ""].filter(Boolean);

  return candidates.find((candidate) => CUSTOM_ACTION_VERBS.includes(candidate));
}

function looksNoisy(tool: EndpointToolDefinition): boolean {
  const haystack = normalizeText(`${tool.name} ${tool.path} ${tool.description}`);
  return NOISE_HINTS.some((hint) => haystack.includes(hint));
}

function isCollectionGet(tool: EndpointToolDefinition): boolean {
  return tool.method === "GET" && !hasTrailingPathParam(tool);
}

function isEntityGet(tool: EndpointToolDefinition): boolean {
  return tool.method === "GET" && hasTrailingPathParam(tool);
}

function isCreate(tool: EndpointToolDefinition): boolean {
  return tool.method === "POST" && !extractSemanticVerb(tool);
}

function isUpdate(tool: EndpointToolDefinition): boolean {
  return (tool.method === "PATCH" || tool.method === "PUT") && hasTrailingPathParam(tool);
}

function isDelete(tool: EndpointToolDefinition): boolean {
  return tool.method === "DELETE";
}

function isCustomAction(tool: EndpointToolDefinition): boolean {
  return Boolean(extractSemanticVerb(tool));
}

function isUsefulQueryParam(parameter: ToolParameter): boolean {
  if (parameter.location !== "query") {
    return false;
  }
  const name = normalizeText(parameter.name);
  return USEFUL_QUERY_PARAMS.includes(name) || parameter.required;
}

function sortParameters(parameters: ToolParameter[]): ToolParameter[] {
  return [...parameters].sort((left, right) => {
    if (left.required !== right.required) {
      return left.required ? -1 : 1;
    }
    const leftScore = USEFUL_QUERY_PARAMS.indexOf(normalizeText(left.name));
    const rightScore = USEFUL_QUERY_PARAMS.indexOf(normalizeText(right.name));
    const normalizedLeftScore = leftScore === -1 ? USEFUL_QUERY_PARAMS.length : leftScore;
    const normalizedRightScore = rightScore === -1 ? USEFUL_QUERY_PARAMS.length : rightScore;
    if (normalizedLeftScore !== normalizedRightScore) {
      return normalizedLeftScore - normalizedRightScore;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeType(type: string): string {
  const normalized = type.toLowerCase();
  if (["string", "number", "integer", "boolean", "object", "array", "null"].includes(normalized)) {
    return normalized;
  }
  return "string";
}

function buildSchemaForParameters(parameters: ToolParameter[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of parameters) {
    const schema: Record<string, unknown> = {
      type: normalizeType(parameter.type),
      description: parameter.description,
    };

    if (parameter.default !== undefined) {
      schema.default = parameter.default;
    }

    if (parameter.enum && parameter.enum.length > 0) {
      schema.enum = parameter.enum;
    }

    properties[parameter.name] = schema;
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    result.required = [...new Set(required)];
  }
  return result;
}

function buildWorkflowInputSchema(
  tool: EndpointToolDefinition,
  mode: "find" | "default",
): Record<string, unknown> {
  const parameters =
    mode === "find"
      ? [
          ...tool.parameters.filter((parameter) => parameter.location === "path"),
          ...sortParameters(tool.parameters.filter((parameter) => isUsefulQueryParam(parameter))).slice(0, 6),
        ]
      : tool.parameters;

  const baseSchema = buildSchemaForParameters(parameters);
  const properties = (baseSchema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(baseSchema.required)
    ? baseSchema.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (tool.requestBody) {
    properties.body = toJsonSchema(tool.requestBody.schema);
    if (tool.requestBody.required) {
      required.push("body");
    }
  }

  const result: Record<string, unknown> = {
    ...baseSchema,
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    result.required = [...new Set(required)];
  }
  return result;
}

function buildArgsFromSchema(
  inputSchema: Record<string, unknown>,
): Record<string, { $fromInput: string }> {
  const properties =
    inputSchema.properties && typeof inputSchema.properties === "object" && !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    Object.keys(properties).map((key) => [key, { $fromInput: key }]),
  );
}

function workflowDescriptionFor(tool: EndpointToolDefinition, resource: ResourceInfo): string {
  if (isCollectionGet(tool)) {
    return truncateText(
      `Find ${resource.humanPlural} using the most useful filters from the upstream API and return matching results.`,
      220,
    );
  }

  if (isEntityGet(tool)) {
    return truncateText(
      `Fetch a ${resource.humanSingular} by ID and return its latest details from the upstream API.`,
      220,
    );
  }

  if (isCreate(tool)) {
    return truncateText(
      `Create a ${resource.humanSingular} using the upstream API payload and return the API response.`,
      220,
    );
  }

  if (isUpdate(tool)) {
    return truncateText(
      `Update an existing ${resource.humanSingular} and return the upstream API response.`,
      220,
    );
  }

  if (isDelete(tool)) {
    return truncateText(
      `Delete a ${resource.humanSingular} and return the upstream API response.`,
      220,
    );
  }

  const verb = extractSemanticVerb(tool) ?? "run";
  return truncateText(
    `${verb.charAt(0).toUpperCase() + verb.slice(1)} a ${resource.humanSingular} workflow and return the upstream API response.`,
    220,
  );
}

function workflowNameFor(tool: EndpointToolDefinition, resource: ResourceInfo): string {
  if (isCollectionGet(tool)) {
    return `find_${resource.plural}`;
  }

  if (isEntityGet(tool)) {
    return `get_${resource.singular}`;
  }

  if (isCreate(tool)) {
    return `create_${resource.singular}`;
  }

  if (isUpdate(tool)) {
    return `update_${resource.singular}`;
  }

  if (isDelete(tool)) {
    return `delete_${resource.singular}`;
  }

  const verb = extractSemanticVerb(tool) ?? "run";
  return `${verb}_${resource.singular}`;
}

function scoreCandidate(tool: EndpointToolDefinition, preferredOperationIds: Set<string>): number {
  let score = 0;

  if (preferredOperationIds.has(normalizeText(tool.originalOperationId ?? tool.name))) {
    score += 100;
  }

  if (tool.priority === "high") {
    score += 20;
  } else if (tool.priority === "medium") {
    score += 10;
  }

  if (isCollectionGet(tool) || isEntityGet(tool)) {
    score += 12;
  }
  if (isCreate(tool)) {
    score += 8;
  }
  if (isUpdate(tool)) {
    score += 7;
  }
  if (isDelete(tool)) {
    score += 5;
  }
  if (isCustomAction(tool)) {
    score += 9;
  }

  if (tool.requestBody?.required) {
    score += 2;
  }

  return score;
}

function toWorkflowCandidate(
  tool: EndpointToolDefinition,
  preferredOperationIds: Set<string>,
): WorkflowCandidate | undefined {
  if (looksNoisy(tool)) {
    return undefined;
  }

  const operationId = tool.originalOperationId ?? tool.name;
  if (!operationId) {
    return undefined;
  }

  const resource = resolveResourceInfo(tool);
  const inputSchema = buildWorkflowInputSchema(tool, isCollectionGet(tool) ? "find" : "default");
  const args = buildArgsFromSchema(inputSchema);
  const stepId = `${workflowNameFor(tool, resource)}_step`;
  const step: WorkflowStepDefinition = {
    id: stepId,
    operationId,
    args,
    saveAs: stepId,
  };

  return {
    workflow: {
      kind: "workflow",
      name: workflowNameFor(tool, resource),
      description: workflowDescriptionFor(tool, resource),
      tags: tool.tags,
      responseDescription: tool.responseDescription,
      inputSchema,
      dependsOnOperationIds: [operationId],
      steps: [step],
      output: {
        $fromStep: stepId,
      },
    },
    score: scoreCandidate(tool, preferredOperationIds),
  };
}

function dedupeWorkflowCandidates(candidates: WorkflowCandidate[]): WorkflowCandidate[] {
  const seen = new Set<string>();
  const deduped: WorkflowCandidate[] = [];

  for (const candidate of candidates) {
    const operationId = normalizeText(candidate.workflow.dependsOnOperationIds[0] ?? candidate.workflow.name);
    const key = `${normalizeText(candidate.workflow.name)}::${operationId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  const nameCounts = new Map<string, number>();
  return deduped.map((candidate) => {
    const baseName = candidate.workflow.name;
    const count = nameCounts.get(baseName) ?? 0;
    nameCounts.set(baseName, count + 1);
    if (count === 0) {
      return candidate;
    }

    return {
      ...candidate,
      workflow: {
        ...candidate.workflow,
        name: `${baseName}_${count + 1}`,
      },
    };
  });
}

function sortEndpointsForFallback(
  tools: EndpointToolDefinition[],
  preferredOperationIds: Set<string>,
): EndpointToolDefinition[] {
  return [...tools].sort((left, right) => {
    const leftScore = scoreCandidate(left, preferredOperationIds);
    const rightScore = scoreCandidate(right, preferredOperationIds);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.name.localeCompare(right.name);
  });
}

export function planWorkflowTools(
  sourceIR: MCPForgeIR,
  options: WorkflowPlanningOptions = {},
): MCPForgeIR {
  const logger = options.logger ?? defaultLogger;
  const maxTools = Math.max(1, Math.floor(options.maxTools ?? 12));
  const maxWorkflows = Math.max(1, Math.floor(options.maxWorkflows ?? Math.min(maxTools, 12)));
  const minWorkflowCount = Math.max(1, Math.floor(options.minWorkflowCount ?? Math.min(5, maxTools)));
  const includeEndpointFallback = options.includeEndpointFallback ?? true;
  const preferredOperationIds = new Set(
    (options.preferredOperationIds ?? []).map((value) => normalizeText(value)),
  );

  const endpointTools = sourceIR.tools.filter(
    (tool): tool is EndpointToolDefinition => tool.kind === "endpoint",
  );

  const workflowCandidates = dedupeWorkflowCandidates(
    endpointTools
      .map((tool) => toWorkflowCandidate(tool, preferredOperationIds))
      .filter((candidate): candidate is WorkflowCandidate => Boolean(candidate)),
  )
    .sort((left, right) => right.score - left.score || left.workflow.name.localeCompare(right.workflow.name))
    .slice(0, maxWorkflows);

  const selectedTools: ToolDefinition[] = workflowCandidates.map((candidate) => candidate.workflow);
  const usedOperationIds = new Set(
    selectedTools
      .filter((tool): tool is WorkflowToolDefinition => tool.kind === "workflow")
      .flatMap((tool) => tool.dependsOnOperationIds)
      .map((value) => normalizeText(value)),
  );

  if (includeEndpointFallback && selectedTools.length < maxTools) {
    for (const endpointTool of sortEndpointsForFallback(endpointTools, preferredOperationIds)) {
      const operationId = normalizeText(endpointTool.originalOperationId ?? endpointTool.name);
      if (usedOperationIds.has(operationId)) {
        continue;
      }
      selectedTools.push(endpointTool);
      if (selectedTools.length >= maxTools) {
        break;
      }
      if (workflowCandidates.length >= minWorkflowCount && selectedTools.length >= workflowCandidates.length + 3) {
        break;
      }
    }
  }

  logger(
    `[mcpforge] Planned ${workflowCandidates.length} workflow tool(s)` +
      (selectedTools.length > workflowCandidates.length
        ? ` plus ${selectedTools.length - workflowCandidates.length} fallback endpoint tool(s).`
        : "."),
  );

  return {
    ...sourceIR,
    tools: selectedTools,
  };
}
