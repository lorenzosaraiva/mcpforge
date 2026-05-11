import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isDeepStrictEqual } from "node:util";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  isEndpointTool,
  isWorkflowTool,
  type AuthConfig,
  type EndpointToolDefinition,
  type MCPForgeIR,
  type ToolDefinition,
} from "../core.js";
import { truncateText } from "../../../core/src/utils/schema-utils.js";
import { buildCompatibilityInvocationArgs, type ToolTestResult } from "./test-runner.js";

type CallToolResponse = Awaited<ReturnType<Client["callTool"]>>;

interface ExpectedBody {
  kind: "none" | "json" | "form" | "multipart" | "text" | "binary";
  value?: unknown;
}

interface RequestExpectation {
  label: string;
  method: string;
  path: string;
  query: Record<string, string[]>;
  headers: Record<string, string>;
  body: ExpectedBody;
  responseBody: Record<string, unknown>;
}

interface ParsedRequestBody {
  kind: ExpectedBody["kind"];
  value?: unknown;
}

interface ParsedRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  headers: Record<string, string>;
  contentType: string;
  body: ParsedRequestBody;
}

interface CompatibilityHarnessState {
  expectations: RequestExpectation[];
  failure?: string;
}

export interface CompatibilityHarness {
  baseUrl: string;
  env: Record<string, string>;
  prepare(tool: ToolDefinition, args: Record<string, unknown>, sourceIR: MCPForgeIR): void;
  finish(): string | undefined;
  close(): Promise<void>;
}

interface CompatibilityTestOptions {
  timeout: number;
  sourceIR: MCPForgeIR;
  getServerStderrOutput?: () => string;
  harness: CompatibilityHarness;
}

const DEFAULT_AUTH_TOKEN = "compat-token";
const DEFAULT_BASIC_AUTH = "compat-user:compat-password";
const DEFAULT_OAUTH_ACCESS_TOKEN = "compat-oauth-token";
const DEFAULT_OAUTH_CLIENT_ID = "compat-client-id";
const DEFAULT_OAUTH_CLIENT_SECRET = "compat-client-secret";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function addMultiValue(record: Record<string, string[]>, key: string, value: string): void {
  const current = record[key];
  if (current) {
    current.push(value);
    return;
  }
  record[key] = [value];
}

function normalizeQueryRecord(input: URLSearchParams): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of input.entries()) {
    addMultiValue(result, key, value);
  }
  return result;
}

function normalizeValueForForm(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTextValue(entry));
  }
  return normalizeTextValue(value);
}

function normalizeObjectAsForm(input: Record<string, unknown>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    result[key] = normalizeValueForForm(value);
  }
  return result;
}

function normalizeSearchParamsAsForm(input: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const grouped = normalizeQueryRecord(input);
  for (const [key, values] of Object.entries(grouped)) {
    result[key] = values.length <= 1 ? values[0] ?? "" : values;
  }
  return result;
}

function normalizeBinaryDescriptor(value: unknown): {
  filename?: string;
  contentType?: string;
  content?: string;
  base64?: string;
} {
  if (!isRecord(value)) {
    return {};
  }

  if (typeof value.base64 === "string") {
    return {
      filename: typeof value.filename === "string" ? value.filename : undefined,
      contentType: typeof value.contentType === "string" ? value.contentType : undefined,
      base64: value.base64,
    };
  }

  if (typeof value.content === "string") {
    return {
      filename: typeof value.filename === "string" ? value.filename : undefined,
      contentType: typeof value.contentType === "string" ? value.contentType : undefined,
      content: value.content,
    };
  }

  return {};
}

function normalizeMultipartValue(
  value: unknown,
): string | Record<string, unknown> | Array<string | Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMultipartValue(entry) as string | Record<string, unknown>);
  }

  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (isRecord(value) && (typeof value.base64 === "string" || typeof value.content === "string")) {
    return normalizeBinaryDescriptor(value);
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeMultipartObject(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    result[key] = normalizeMultipartValue(value);
  }
  return result;
}

function normalizeTextBody(value: unknown): string {
  return normalizeTextValue(value);
}

function normalizeBinaryBody(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.base64 === "string") {
    return value.base64;
  }

  if (isRecord(value) && typeof value.content === "string") {
    return Buffer.from(value.content, "utf8").toString("base64");
  }

  throw new Error("Unsupported binary request body for compatibility validation.");
}

function isTextLikeContentType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("text/xml") ||
    contentType.includes("application/graphql")
  );
}

function buildExpectedBody(tool: EndpointToolDefinition, args: Record<string, unknown>): ExpectedBody {
  if (!tool.requestBody || args.body === undefined || args.body === null) {
    return { kind: "none" };
  }

  const normalizedContentType = tool.requestBody.contentType.toLowerCase();
  if (normalizedContentType.includes("application/json") || normalizedContentType.endsWith("+json")) {
    return {
      kind: "json",
      value: args.body,
    };
  }

  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    if (!isRecord(args.body)) {
      throw new Error(`Compatibility validation expected a plain object body for ${tool.name}.`);
    }
    return {
      kind: "form",
      value: normalizeObjectAsForm(args.body),
    };
  }

  if (normalizedContentType.includes("multipart/form-data")) {
    if (!isRecord(args.body)) {
      throw new Error(`Compatibility validation expected a plain object multipart body for ${tool.name}.`);
    }
    return {
      kind: "multipart",
      value: normalizeMultipartObject(args.body),
    };
  }

  if (isTextLikeContentType(normalizedContentType)) {
    return {
      kind: "text",
      value: normalizeTextBody(args.body),
    };
  }

  return {
    kind: "binary",
    value: normalizeBinaryBody(args.body),
  };
}

function buildResolvedPath(tool: EndpointToolDefinition, args: Record<string, unknown>): string {
  let resolvedPath = tool.path;
  for (const parameter of tool.parameters.filter((candidate) => candidate.location === "path")) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      throw new Error(`Compatibility validation could not resolve path parameter "${parameter.name}" for ${tool.name}.`);
    }
    resolvedPath = resolvedPath.split(`{${parameter.name}}`).join(encodeURIComponent(String(value)));
  }
  return resolvedPath;
}

function buildExpectedQuery(tool: EndpointToolDefinition, args: Record<string, unknown>, auth: AppliedAuth): Record<string, string[]> {
  const query = new URLSearchParams();

  for (const parameter of tool.parameters.filter((candidate) => candidate.location === "query")) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        query.append(parameter.name, normalizeTextValue(entry));
      }
      continue;
    }

    query.append(parameter.name, normalizeTextValue(value));
  }

  for (const [key, value] of Object.entries(auth.queryParams)) {
    query.delete(key);
    query.append(key, value);
  }

  return normalizeQueryRecord(query);
}

function buildExpectedHeaders(tool: EndpointToolDefinition, args: Record<string, unknown>, auth: AppliedAuth): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const parameter of tool.parameters.filter((candidate) => candidate.location === "header")) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      continue;
    }
    headers[parameter.name] = normalizeTextValue(value);
  }

  for (const [key, value] of Object.entries(auth.headers)) {
    if (normalizeHeaderName(key) === "cookie" && headers.Cookie) {
      headers.Cookie = `${headers.Cookie}; ${value}`;
      continue;
    }
    headers[key] = value;
  }

  if (tool.requestBody) {
    const contentType = tool.requestBody.contentType.toLowerCase();
    if (!contentType.includes("multipart/form-data") && args.body !== undefined && args.body !== null) {
      headers["Content-Type"] = tool.requestBody.contentType;
    }
  }

  return headers;
}

function buildResponseBody(expectation: RequestExpectation): Record<string, unknown> {
  const syntheticId = `${expectation.label.replace(/[^a-zA-Z0-9]+/g, "_") || "step"}_id`;
  return {
    ok: true,
    id: syntheticId,
    data: {
      id: syntheticId,
    },
    echoedRequest: {
      method: expectation.method,
      path: expectation.path,
      query: expectation.query,
      headers: expectation.headers,
      body: expectation.body.value ?? null,
    },
  };
}

function getOperationId(tool: EndpointToolDefinition): string {
  return tool.originalOperationId ?? tool.name;
}

function createEndpointMap(sourceIR: MCPForgeIR): Map<string, EndpointToolDefinition> {
  const endpointMap = new Map<string, EndpointToolDefinition>();
  for (const tool of sourceIR.tools) {
    if (!isEndpointTool(tool)) {
      continue;
    }
    endpointMap.set(tool.name, tool);
    endpointMap.set(getOperationId(tool), tool);
  }
  return endpointMap;
}

function getPathValue(source: unknown, path: string): unknown {
  if (!path.trim()) {
    return source;
  }

  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function resolveWorkflowReference(
  value: unknown,
  input: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): unknown {
  if (!isRecord(value) || Array.isArray(value)) {
    return value;
  }

  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.$fromInput === "string") {
    return getPathValue(input, value.$fromInput);
  }
  if (keys.length === 1 && typeof value.$fromStep === "string") {
    const [stepKey, ...rest] = value.$fromStep.split(".");
    const base = stepResults[stepKey];
    return rest.length === 0 ? base : getPathValue(base, rest.join("."));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = resolveWorkflowValue(child, input, stepResults);
  }
  return result;
}

function resolveWorkflowValue(
  value: unknown,
  input: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveWorkflowValue(entry, input, stepResults));
  }

  if (!isRecord(value) || Array.isArray(value)) {
    return value;
  }

  return resolveWorkflowReference(value, input, stepResults);
}

interface AppliedAuth {
  env: Record<string, string>;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
}

function applyAuth(auth: AuthConfig): AppliedAuth {
  if (auth.type === "none") {
    return {
      env: {},
      headers: {},
      queryParams: {},
    };
  }

  const envValue = auth.type === "basic" ? DEFAULT_BASIC_AUTH : DEFAULT_AUTH_TOKEN;
  const parameterName = auth.parameterName ?? auth.headerName ?? "Authorization";
  const headerName = auth.headerName ?? auth.parameterName ?? "Authorization";
  const location = auth.location ?? "header";

  if (auth.type === "api-key") {
    if (location === "query") {
      return {
        env: { [auth.envVarName]: envValue },
        headers: {},
        queryParams: { [parameterName]: envValue },
      };
    }

    if (location === "cookie") {
      return {
        env: { [auth.envVarName]: envValue },
        headers: {
          Cookie: `${parameterName}=${encodeURIComponent(envValue)}`,
        },
        queryParams: {},
      };
    }

    return {
      env: { [auth.envVarName]: envValue },
      headers: { [headerName]: envValue },
      queryParams: {},
    };
  }

  if (auth.type === "basic") {
    return {
      env: { [auth.envVarName]: envValue },
      headers: {
        [headerName]: `Basic ${Buffer.from(envValue).toString("base64")}`,
      },
      queryParams: {},
    };
  }

  if (auth.type === "oauth2" && (auth.oauthFlow || auth.tokenUrl || auth.refreshUrl)) {
    return {
      env: {
        OAUTH_TOKEN_URL: "__MCPFORGE_OAUTH_TOKEN_URL__",
        OAUTH_CLIENT_ID: DEFAULT_OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET: DEFAULT_OAUTH_CLIENT_SECRET,
      },
      headers: {
        [headerName]: `Bearer ${DEFAULT_OAUTH_ACCESS_TOKEN}`,
      },
      queryParams: {},
    };
  }

  const scheme = auth.scheme ?? "Bearer";
  return {
    env: { [auth.envVarName]: envValue },
    headers: {
      [headerName]: `${scheme} ${envValue}`,
    },
    queryParams: {},
  };
}

function buildEndpointExpectation(
  tool: EndpointToolDefinition,
  args: Record<string, unknown>,
  auth: AppliedAuth,
): RequestExpectation {
  const expectation: RequestExpectation = {
    label: tool.name,
    method: tool.method.toUpperCase(),
    path: buildResolvedPath(tool, args),
    query: buildExpectedQuery(tool, args, auth),
    headers: buildExpectedHeaders(tool, args, auth),
    body: buildExpectedBody(tool, args),
    responseBody: {},
  };
  expectation.responseBody = buildResponseBody(expectation);
  return expectation;
}

function buildWorkflowExpectations(
  tool: Extract<ToolDefinition, { kind: "workflow" }>,
  args: Record<string, unknown>,
  sourceIR: MCPForgeIR,
  auth: AppliedAuth,
): RequestExpectation[] {
  const endpointMap = createEndpointMap(sourceIR);
  const stepResults: Record<string, unknown> = {};
  const expectations: RequestExpectation[] = [];

  for (const step of tool.steps) {
    const endpointTool = endpointMap.get(step.operationId);
    if (!endpointTool) {
      throw new Error(`Compatibility validation could not resolve workflow dependency "${step.operationId}" for ${tool.name}.`);
    }

    const resolvedArgs = resolveWorkflowValue(step.args, args, stepResults);
    const endpointArgs = isRecord(resolvedArgs) ? resolvedArgs : {};
    const expectation = buildEndpointExpectation(endpointTool, endpointArgs, auth);
    expectation.label = `${tool.name}:${step.id}`;
    expectation.responseBody = buildResponseBody(expectation);
    expectations.push(expectation);

    const simulatedResult = {
      status: 200,
      data: expectation.responseBody,
    };
    stepResults[step.id] = simulatedResult;
    if (step.saveAs) {
      stepResults[step.saveAs] = simulatedResult;
    }
  }

  return expectations;
}

function buildExpectations(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  sourceIR: MCPForgeIR,
  authConfig: AuthConfig,
): RequestExpectation[] {
  const auth = applyAuth(authConfig);
  if (isEndpointTool(tool)) {
    return [buildEndpointExpectation(tool, args, auth)];
  }

  return buildWorkflowExpectations(tool, args, sourceIR, auth);
}

function parseHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[normalizeHeaderName(key)] = value;
      continue;
    }
    if (Array.isArray(value)) {
      result[normalizeHeaderName(key)] = value.join(", ");
    }
  }
  return result;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function parseMultipartBody(
  rawBody: Buffer,
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const parsedHeaders = parseHeaders(request.headers);
  const syntheticRequest = new Request("http://compat.local/", {
    method: request.method,
    headers: parsedHeaders,
    body: rawBody,
  });
  const formData = await syntheticRequest.formData();
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    let normalized: unknown;
    if (value instanceof File) {
      if (value.type.startsWith("text/")) {
        normalized = {
          filename: value.name,
          contentType: value.type,
          content: await value.text(),
        };
      } else {
        normalized = {
          filename: value.name,
          contentType: value.type,
          base64: Buffer.from(await value.arrayBuffer()).toString("base64"),
        };
      }
    } else {
      normalized = value;
    }

    const existing = result[key];
    if (existing === undefined) {
      result[key] = normalized;
      continue;
    }

    result[key] = Array.isArray(existing) ? [...existing, normalized] : [existing, normalized];
  }

  return result;
}

async function parseRequestBody(
  request: IncomingMessage,
  rawBody: Buffer,
  expectation: RequestExpectation,
): Promise<ParsedRequestBody> {
  if (expectation.body.kind === "none") {
    return {
      kind: "none",
      value: rawBody.length === 0 ? undefined : rawBody.toString("utf8"),
    };
  }

  if (expectation.body.kind === "json") {
    return {
      kind: "json",
      value: rawBody.length === 0 ? null : JSON.parse(rawBody.toString("utf8")),
    };
  }

  if (expectation.body.kind === "form") {
    return {
      kind: "form",
      value: normalizeSearchParamsAsForm(new URLSearchParams(rawBody.toString("utf8"))),
    };
  }

  if (expectation.body.kind === "multipart") {
    return {
      kind: "multipart",
      value: await parseMultipartBody(rawBody, request),
    };
  }

  if (expectation.body.kind === "text") {
    return {
      kind: "text",
      value: rawBody.toString("utf8"),
    };
  }

  return {
    kind: "binary",
    value: rawBody.toString("base64"),
  };
}

async function parseRequest(
  request: IncomingMessage,
  expectation: RequestExpectation,
): Promise<ParsedRequest> {
  const url = new URL(request.url ?? "/", "http://compat.local");
  const rawBody = await readRequestBody(request);
  const headers = parseHeaders(request.headers);
  return {
    method: (request.method ?? "GET").toUpperCase(),
    path: url.pathname,
    query: normalizeQueryRecord(url.searchParams),
    headers,
    contentType: headers["content-type"] ?? "",
    body: await parseRequestBody(request, rawBody, expectation),
  };
}

function compareHeaders(expected: Record<string, string>, actual: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(expected)) {
    const actualValue = actual[normalizeHeaderName(key)];
    if (actualValue !== value) {
      return `Expected header "${key}" to equal "${value}" but received "${actualValue ?? "(missing)"}".`;
    }
  }
  return undefined;
}

function compareBody(expectation: RequestExpectation, actual: ParsedRequest): string | undefined {
  if (expectation.body.kind !== actual.body.kind) {
    return `Expected ${expectation.body.kind} body but received ${actual.body.kind}.`;
  }

  if (expectation.body.kind === "multipart" && !actual.contentType.toLowerCase().includes("multipart/form-data")) {
    return `Expected multipart/form-data content type but received "${actual.contentType || "(missing)"}".`;
  }

  if (!isDeepStrictEqual(actual.body.value, expectation.body.value)) {
    return `Expected request body ${JSON.stringify(expectation.body.value)} but received ${JSON.stringify(actual.body.value)}.`;
  }

  return undefined;
}

function compareRequest(expectation: RequestExpectation, actual: ParsedRequest): string | undefined {
  if (actual.method !== expectation.method) {
    return `Expected ${expectation.method} ${expectation.path} but received ${actual.method} ${actual.path}.`;
  }

  if (actual.path !== expectation.path) {
    return `Expected path "${expectation.path}" but received "${actual.path}".`;
  }

  if (!isDeepStrictEqual(actual.query, expectation.query)) {
    return `Expected query ${JSON.stringify(expectation.query)} but received ${JSON.stringify(actual.query)}.`;
  }

  const headerMismatch = compareHeaders(expectation.headers, actual.headers);
  if (headerMismatch) {
    return headerMismatch;
  }

  return compareBody(expectation, actual);
}

class HarnessImpl implements CompatibilityHarness {
  baseUrl = "";
  env: Record<string, string> = {};

  private readonly state: CompatibilityHarnessState = {
    expectations: [],
  };

  private readonly server = createServer(async (request, response) => {
    await this.handleRequest(request, response);
  });

  async start(auth: AuthConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;

    const authState = applyAuth(auth);
    this.env = {
      API_BASE_URL: this.baseUrl,
      ...authState.env,
    };

    if (this.env.OAUTH_TOKEN_URL === "__MCPFORGE_OAUTH_TOKEN_URL__") {
      this.env.OAUTH_TOKEN_URL = `${this.baseUrl}/__oauth/token`;
    }
  }

  prepare(tool: ToolDefinition, args: Record<string, unknown>, sourceIR: MCPForgeIR): void {
    this.state.expectations = buildExpectations(tool, args, sourceIR, sourceIR.auth);
    this.state.failure = undefined;
  }

  finish(): string | undefined {
    if (this.state.failure) {
      return this.state.failure;
    }

    if (this.state.expectations.length > 0) {
      return `${this.state.expectations.length} expected request(s) were not made.`;
    }

    return undefined;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", "http://compat.local");
    if (requestUrl.pathname === "/__oauth/token") {
      await this.handleOAuthTokenRequest(request, response);
      return;
    }

    const expectation = this.state.expectations.shift();
    if (!expectation) {
      this.state.failure = "Received an unexpected upstream request.";
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: this.state.failure }));
      return;
    }

    try {
      const actualRequest = await parseRequest(request, expectation);
      const mismatch = compareRequest(expectation, actualRequest);
      if (mismatch) {
        this.state.failure = mismatch;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: mismatch }));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(expectation.responseBody));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown compatibility server error";
      this.state.failure = message;
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: message }));
    }
  }

  private async handleOAuthTokenRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const rawBody = await readRequestBody(request);
      const body = new URLSearchParams(rawBody.toString("utf8"));
      const grantType = body.get("grant_type");
      if (request.method?.toUpperCase() !== "POST") {
        this.state.failure = "OAuth token endpoint expected POST.";
        response.statusCode = 405;
        response.end();
        return;
      }
      if (grantType !== "client_credentials" && grantType !== "refresh_token") {
        this.state.failure = `OAuth token endpoint received unsupported grant_type "${grantType ?? "(missing)"}".`;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: this.state.failure }));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        access_token: DEFAULT_OAUTH_ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OAuth compatibility server error";
      this.state.failure = message;
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: message }));
    }
  }
}

export async function createCompatibilityHarness(auth: AuthConfig): Promise<CompatibilityHarness> {
  const harness = new HarnessImpl();
  await harness.start(auth);
  return harness;
}

function getToolResponseText(result: CallToolResponse): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return "";
  }

  return result.content
    .filter(
      (entry): entry is Extract<(typeof result.content)[number], { type: "text"; text: string }> =>
        entry.type === "text" && typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("\n")
    .trim();
}

function buildCompatibilityResult(
  toolName: string,
  status: ToolTestResult["status"],
  message: string,
  durationMs: number,
): ToolTestResult {
  return {
    toolName,
    phase: "invocation",
    status,
    message,
    durationMs,
  };
}

function buildFailureMessage(error: unknown, getServerStderrOutput?: () => string): string {
  const baseMessage = error instanceof Error ? error.message : "Unknown compatibility error";
  const stderr = truncateText(getServerStderrOutput?.() ?? "", 160);
  return stderr.length > 0 && !baseMessage.includes(stderr) ? `${baseMessage} | stderr: ${stderr}` : baseMessage;
}

export async function runCompatibilityTests(
  client: Client,
  tools: ToolDefinition[],
  options: CompatibilityTestOptions,
): Promise<ToolTestResult[]> {
  const results: ToolTestResult[] = [];

  for (const tool of tools) {
    const startedAt = Date.now();
    const invocationArgs = buildCompatibilityInvocationArgs(tool);
    options.harness.prepare(tool, invocationArgs, options.sourceIR);

    try {
      const response = await client.callTool(
        {
          name: tool.name,
          arguments: invocationArgs,
        },
        undefined,
        {
          timeout: options.timeout,
        },
      );

      const mismatch = options.harness.finish();
      if (mismatch) {
        results.push(
          buildCompatibilityResult(tool.name, "fail", mismatch, Date.now() - startedAt),
        );
        continue;
      }

      if ("isError" in response && response.isError === true) {
        results.push(
          buildCompatibilityResult(
            tool.name,
            "fail",
            truncateText(getToolResponseText(response) || "Compatibility tool call failed.", 160),
            Date.now() - startedAt,
          ),
        );
        continue;
      }

      results.push(
        buildCompatibilityResult(tool.name, "pass", "compatibility pass", Date.now() - startedAt),
      );
    } catch (error) {
      results.push(
        buildCompatibilityResult(
          tool.name,
          "fail",
          buildFailureMessage(error, options.getServerStderrOutput),
          Date.now() - startedAt,
        ),
      );
    }
  }

  return results;
}
