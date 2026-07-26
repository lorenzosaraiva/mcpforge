export {
  diffIR,
  generateTypeScriptMCPServer,
  inferIRFromDocs,
  isEndpointTool,
  isWorkflowTool,
  optimizeIRWithAI,
  parseOpenAPISpec,
  planWorkflowTools,
  scrapeDocsFromUrl,
  truncateText,
} from "@mcpforge/core";

export type {
  DiffChange,
  DiffResult,
  AuthConfig,
  EndpointToolDefinition,
  MCPForgeIR,
  OptimizerMode,
  RegistryEntry,
  RegistryIndex,
  RegistryIndexEntry,
  ScrapedDocPage,
  ToolDefinition,
  WorkflowToolDefinition,
} from "@mcpforge/core";
