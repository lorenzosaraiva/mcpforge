import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Handlebars from "handlebars";

import type { MCPForgeIR, ToolDefinition } from "../parser/types.js";
import type { GenerateProjectOptions, GenerateProjectResult } from "./types.js";
import { toJsonSchema, toKebabCase } from "../utils/schema-utils.js";

interface PreparedTool {
  name: string;
  description: string;
  method: string;
  path: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
  handlerFunctionName: string;
  handlerFileName: string;
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

function toInputSchema(tool: ToolDefinition): Record<string, unknown> {
  const normalizeType = (type: string): string => {
    const normalized = type.toLowerCase();
    if (["string", "number", "integer", "boolean", "object", "array", "null"].includes(normalized)) {
      return normalized;
    }
    return "string";
  };

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

function prepareTools(ir: MCPForgeIR): PreparedTool[] {
  return ir.tools.map((tool) => {
    const handlerFunctionName = `handle${toPascalCase(tool.name)}`;
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
      description: tool.description,
      method: tool.method.toUpperCase(),
      path: tool.path,
      tags: tool.tags,
      inputSchema: toInputSchema(tool),
      handlerFunctionName,
      handlerFileName: tool.name,
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
  const preparedTools = prepareTools(ir);
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
    generatedAt: new Date().toISOString(),
  };

  let fileCount = 0;

  await writeRenderedFile(
    join(srcDir, "index.ts"),
    join(templateDir, "index.ts.hbs"),
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

  // Avoid EMFILE on large specs by batching tool-file writes.
  const TOOL_WRITE_CONCURRENCY = 16;
  for (let index = 0; index < preparedTools.length; index += TOOL_WRITE_CONCURRENCY) {
    const batch = preparedTools.slice(index, index + TOOL_WRITE_CONCURRENCY);
    await Promise.all(
      batch.map((tool) =>
      writeRenderedFile(
        join(toolsDir, `${tool.handlerFileName}.ts`),
        join(templateDir, "tool-handler.ts.hbs"),
        {
          ...commonTemplateData,
          tool,
        },
      )),
    );
    fileCount += batch.length;
  }

  return {
    outputDir,
    fileCount,
    generatedToolCount: preparedTools.length,
  };
}
