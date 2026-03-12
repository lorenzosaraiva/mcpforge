export interface MCPForgeIR {
  apiName: string;
  apiDescription: string;
  baseUrl: string;
  auth: AuthConfig;
  tools: ToolDefinition[];
  rawEndpointCount: number;
}

export interface AuthConfig {
  type: "none" | "api-key" | "bearer" | "oauth2" | "basic";
  headerName?: string;
  scheme?: string;
  envVarName: string;
  description?: string;
  required?: boolean;
  hasSecuritySchemes?: boolean;
}

export type ToolPriority = "high" | "medium" | "low";

export interface BaseToolDefinition {
  kind: "endpoint" | "workflow";
  name: string;
  description: string;
  tags: string[];
  originalOperationId?: string;
  priority?: ToolPriority;
}

export interface EndpointToolDefinition extends BaseToolDefinition {
  kind: "endpoint";
  method: string;
  path: string;
  parameters: ToolParameter[];
  requestBody?: RequestBodyDef;
  responseDescription?: string;
}

export interface WorkflowValueRef {
  $fromInput?: string;
  $fromStep?: string;
}

export type WorkflowValue =
  | string
  | number
  | boolean
  | null
  | WorkflowValueRef
  | WorkflowValue[]
  | {
      [key: string]: WorkflowValue;
    };

export interface WorkflowStepDefinition {
  id: string;
  operationId: string;
  args: Record<string, WorkflowValue>;
  saveAs?: string;
}

export interface WorkflowToolDefinition extends BaseToolDefinition {
  kind: "workflow";
  inputSchema: Record<string, unknown>;
  dependsOnOperationIds: string[];
  steps: WorkflowStepDefinition[];
  output?: WorkflowValue;
  responseDescription?: string;
}

export type ToolDefinition = EndpointToolDefinition | WorkflowToolDefinition;

export interface ToolParameter {
  name: string;
  description: string;
  type: string;
  required: boolean;
  location: "path" | "query" | "header";
  default?: unknown;
  enum?: unknown[];
}

export interface RequestBodyDef {
  contentType: string;
  schema: Record<string, unknown>;
  required: boolean;
  description?: string;
}

export function isEndpointTool(tool: ToolDefinition): tool is EndpointToolDefinition {
  return tool.kind === "endpoint";
}

export function isWorkflowTool(tool: ToolDefinition): tool is WorkflowToolDefinition {
  return tool.kind === "workflow";
}
