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

export interface ToolDefinition {
  name: string;
  description: string;
  method: string;
  path: string;
  parameters: ToolParameter[];
  requestBody?: RequestBodyDef;
  responseDescription?: string;
  tags: string[];
  originalOperationId?: string;
  priority?: ToolPriority;
}

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
