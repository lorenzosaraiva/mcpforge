export * from "./parser/types.js";
export { parseOpenAPISpec } from "./parser/openapi-parser.js";

export * from "./registry/types.js";

export * from "./optimizer/types.js";
export { optimizeIRWithAI } from "./optimizer/ai-optimizer.js";

export * from "./generator/types.js";
export {
  generateTypeScriptMCPServer,
  getGeneratorIdentity,
} from "./generator/typescript-generator.js";
export { GENERATOR_RUNTIME_VERSION } from "./generator/runtime-version.js";
export {
  applyReadOnlyPolicy,
  isReadOnlyTool,
  toolAnnotations,
} from "./generator/policy.js";

export * from "./differ/ir-differ.js";
export { diffIR } from "./differ/ir-differ.js";

export { planWorkflowTools } from "./planner/workflow-planner.js";
export {
  toJsonSchema,
  toStructuredOutputSchema,
  rebaseJsonSchema,
  truncateText,
} from "./utils/schema-utils.js";

export * from "./scraper/docs-scraper.js";
export { scrapeDocsFromUrl } from "./scraper/docs-scraper.js";

export * from "./scraper/ai-inferrer.js";
export { inferIRFromDocs } from "./scraper/ai-inferrer.js";
