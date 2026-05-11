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
} from "../../core/src/index.js";

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
} from "../../core/src/index.js";
