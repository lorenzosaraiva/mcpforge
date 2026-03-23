import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Handlebars from "handlebars";

import type {
  EndpointToolDefinition,
  MCPForgeIR,
  ToolDefinition,
  WorkflowStepDefinition,
  WorkflowToolDefinition,
} from "../parser/types.js";
import { isEndpointTool, isWorkflowTool } from "../parser/types.js";
import type { GenerateProjectOptions, GenerateProjectResult } from "./types.js";
import { toJsonSchema, toKebabCase } from "../utils/schema-utils.js";

interface PreparedEndpointRuntime {
  name: string;
  operationId?: string;
  method: string;
  path: string;
  pathParams: Array<{ name: string; token: string }>;
  hasPathParams: boolean;
  queryParams: Array<{ name: string; required: boolean }>;
  hasQueryParams: boolean;
  headerParams: Array<{ name: string; required: boolean }>;
  hasHeaderParams: boolean;
  hasRequestBody: boolean;
  requestBodyRequired: boolean;
  requestBodyContentType: string;
}

interface PreparedPublicToolBase {
  kind: "endpoint" | "workflow";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerFunctionName: string;
  handlerFileName: string;
}

interface PreparedEndpointTool extends PreparedPublicToolBase {
  kind: "endpoint";
  endpoint: PreparedEndpointRuntime;
}

interface PreparedWorkflowStep {
  id: string;
  saveAs?: string;
  args: Record<string, unknown>;
  endpoint: PreparedEndpointRuntime;
}

interface PreparedWorkflowTool extends PreparedPublicToolBase {
  kind: "workflow";
  steps: PreparedWorkflowStep[];
  output?: unknown;
  hasOutput: boolean;
}

type PreparedPublicTool = PreparedEndpointTool | PreparedWorkflowTool;

const moduleDir = dirname(fileURLToPath(import.meta.url));

let helpersRegistered = false;
const templateCache = new Map<string, Handlebars.TemplateDelegate>();

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function registerHelpers(): void {
  if (helpersRegistered) {
    return;
  }

  Handlebars.registerHelper("json", (context: unknown) => JSON.stringify(context, null, 2));
  Handlebars.registerHelper("uppercase", (value: unknown) =>
    typeof value === "string" ? value.toUpperCase() : "",
  );
  Handlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);
  helpersRegistered = true;
}

function resolveTemplateDirectory(): string {
  const candidates = [
    resolve(moduleDir, "templates"),
    resolve(moduleDir, "../../src/generator/templates"),
    resolve(process.cwd(), "packages/core/src/generator/templates"),
  ];

  const selected = candidates.find((candidate) => existsSync(join(candidate, "index.ts.hbs")));
  if (!selected) {
    throw new Error("Template directory could not be resolved.");
  }
  return selected;
}

async function renderTemplate(templatePath: string, data: Record<string, unknown>): Promise<string> {
  let template = templateCache.get(templatePath);
  if (!template) {
    const source = await readFile(templatePath, "utf8");
    template = Handlebars.compile(source, { noEscape: true });
    templateCache.set(templatePath, template);
  }
  return template(data);
}

function normalizeType(type: string): string {
  const normalized = type.toLowerCase();
  if (["string", "number", "integer", "boolean", "object", "array", "null"].includes(normalized)) {
    return normalized;
  }
  return "string";
}

function toEndpointInputSchema(tool: EndpointToolDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of tool.parameters) {
    const schema: Record<string, unknown> = {
      type: normalizeType(parameter.type || "string"),
      description: parameter.description,
    };

    if (parameter.enum && parameter.enum.length > 0) {
      schema.enum = parameter.enum;
    }
    if (parameter.default !== undefined) {
      schema.default = parameter.default;
    }

    properties[parameter.name] = schema;
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (tool.requestBody) {
    properties.body = toJsonSchema(tool.requestBody.schema);
    if (tool.requestBody.required) {
      required.push("body");
    }
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    schema.required = [...new Set(required)];
  }

  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function toPreparedEndpointRuntime(tool: EndpointToolDefinition): PreparedEndpointRuntime {
  const pathParams = tool.parameters
    .filter((param) => param.location === "path")
    .map((param) => ({ name: param.name, token: `{${param.name}}` }));
  const queryParams = tool.parameters
    .filter((param) => param.location === "query")
    .map((param) => ({ name: param.name, required: param.required }));
  const headerParams = tool.parameters
    .filter((param) => param.location === "header")
    .map((param) => ({ name: param.name, required: param.required }));

  return {
    name: tool.name,
    operationId: tool.originalOperationId,
    method: tool.method.toUpperCase(),
    path: tool.path,
    pathParams,
    hasPathParams: pathParams.length > 0,
    queryParams,
    hasQueryParams: queryParams.length > 0,
    headerParams,
    hasHeaderParams: headerParams.length > 0,
    hasRequestBody: Boolean(tool.requestBody),
    requestBodyRequired: tool.requestBody?.required === true,
    requestBodyContentType: tool.requestBody?.contentType ?? "application/json",
  };
}

function createPreparedToolBase(
  tool: ToolDefinition,
  inputSchema: Record<string, unknown>,
): PreparedPublicToolBase {
  return {
    kind: tool.kind,
    name: tool.name,
    description: tool.description,
    inputSchema,
    handlerFunctionName: `handle${toPascalCase(tool.name)}`,
    handlerFileName: tool.name,
  };
}

function resolveEndpointMap(ir: MCPForgeIR, sourceIR?: MCPForgeIR): Map<string, EndpointToolDefinition> {
  const endpointMap = new Map<string, EndpointToolDefinition>();
  const endpointTools = [
    ...(sourceIR?.tools ?? []),
    ...ir.tools,
  ].filter((tool): tool is EndpointToolDefinition => isEndpointTool(tool));

  for (const tool of endpointTools) {
    if (tool.originalOperationId) {
      endpointMap.set(tool.originalOperationId, tool);
    }
    endpointMap.set(tool.name, tool);
  }

  return endpointMap;
}

function prepareWorkflowSteps(
  workflow: WorkflowToolDefinition,
  endpointMap: Map<string, EndpointToolDefinition>,
): PreparedWorkflowStep[] {
  return workflow.steps.map((step: WorkflowStepDefinition) => {
    const endpointTool = endpointMap.get(step.operationId);
    if (!endpointTool) {
      throw new Error(
        `Workflow tool "${workflow.name}" depends on unknown operation "${step.operationId}".`,
      );
    }

    return {
      id: step.id,
      saveAs: step.saveAs,
      args: step.args,
      endpoint: toPreparedEndpointRuntime(endpointTool),
    };
  });
}

function preparePublicTools(ir: MCPForgeIR, sourceIR?: MCPForgeIR): PreparedPublicTool[] {
  const endpointMap = resolveEndpointMap(ir, sourceIR);

  return ir.tools.map((tool) => {
    if (isEndpointTool(tool)) {
      return {
        ...createPreparedToolBase(tool, toEndpointInputSchema(tool)),
        kind: "endpoint",
        endpoint: toPreparedEndpointRuntime(tool),
      };
    }

    const workflowInputSchema = JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>;
    return {
      ...createPreparedToolBase(tool, workflowInputSchema),
      kind: "workflow",
      steps: prepareWorkflowSteps(tool, endpointMap),
      output: tool.output,
      hasOutput: tool.output !== undefined,
    };
  });
}

async function writeRenderedFile(
  outputPath: string,
  templatePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  const rendered = await renderTemplate(templatePath, data);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
}

async function removeStaleToolFiles(toolsDir: string, nextToolNames: string[]): Promise<void> {
  if (!existsSync(toolsDir)) {
    return;
  }

  const expectedFiles = new Set(nextToolNames.map((toolName) => `${toolName}.ts`));
  const existingFiles = await readdir(toolsDir, { withFileTypes: true });

  await Promise.all(
    existingFiles
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !expectedFiles.has(entry.name))
      .map((entry) => unlink(join(toolsDir, entry.name))),
  );
}

export async function generateTypeScriptMCPServer(
  ir: MCPForgeIR,
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  registerHelpers();
  const templateDir = resolveTemplateDirectory();

  const outputDir = resolve(options.outputDir);
  const srcDir = join(outputDir, "src");
  const toolsDir = join(srcDir, "tools");

  await mkdir(toolsDir, { recursive: true });

  const projectName = options.projectName ?? `mcp-server-${toKebabCase(ir.apiName)}`;
  const preparedTools = preparePublicTools(ir, options.sourceIR);
  const hasAuth = ir.auth.type !== "none";
  const authRequired = hasAuth && ir.auth.required === true;
  await removeStaleToolFiles(
    toolsDir,
    preparedTools.map((tool) => tool.handlerFileName),
  );
  const commonTemplateData = {
    projectName,
    apiName: ir.apiName,
    apiDescription: ir.apiDescription,
    baseUrl: ir.baseUrl,
    auth: ir.auth,
    hasAuth,
    authRequired,
    authOptional: hasAuth && !authRequired,
    tools: preparedTools,
    workflowToolCount: preparedTools.filter((tool) => tool.kind === "workflow").length,
    endpointToolCount: preparedTools.filter((tool) => tool.kind === "endpoint").length,
    generatedAt: new Date().toISOString(),
  };

  let fileCount = 0;

  await writeRenderedFile(
    join(srcDir, "index.ts"),
    join(templateDir, "index.ts.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  await writeRenderedFile(
    join(srcDir, "runtime.ts"),
    join(templateDir, "runtime.ts.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  await writeRenderedFile(
    join(srcDir, "resilience.ts"),
    join(templateDir, "resilience.ts.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  if (hasAuth) {
    await writeRenderedFile(
      join(srcDir, "auth.ts"),
      join(templateDir, "auth.ts.hbs"),
      commonTemplateData,
    );
    fileCount += 1;
  }
  await writeRenderedFile(
    join(outputDir, "package.json"),
    join(templateDir, "package.json.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  await writeRenderedFile(
    join(outputDir, "tsconfig.json"),
    join(templateDir, "tsconfig.json.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  await writeRenderedFile(
    join(outputDir, ".env.example"),
    join(templateDir, ".env.example.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  await writeRenderedFile(
    join(outputDir, "README.md"),
    join(templateDir, "README.md.hbs"),
    commonTemplateData,
  );
  fileCount += 1;

  const TOOL_WRITE_CONCURRENCY = 16;
  for (let index = 0; index < preparedTools.length; index += TOOL_WRITE_CONCURRENCY) {
    const batch = preparedTools.slice(index, index + TOOL_WRITE_CONCURRENCY);
    await Promise.all(
      batch.map((tool) =>
        writeRenderedFile(
          join(toolsDir, `${tool.handlerFileName}.ts`),
          join(
            templateDir,
            tool.kind === "workflow" ? "workflow-handler.ts.hbs" : "tool-handler.ts.hbs",
          ),
          {
            ...commonTemplateData,
            tool,
          },
        ),
      ),
    );
    fileCount += batch.length;
  }

  return {
    outputDir,
    fileCount,
    generatedToolCount: preparedTools.length,
  };
}
