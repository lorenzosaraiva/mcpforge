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
  EndpointToolDefinition,
  MCPForgeIR,
  ScrapedDocPage,
  ToolDefinition,
  WorkflowToolDefinition,
} from "../../core/src/index.js";
