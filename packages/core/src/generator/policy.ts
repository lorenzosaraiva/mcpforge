import type { MCPForgeIR, ToolDefinition } from "../parser/types.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isReadOnlyTool(
  tool: ToolDefinition,
  sourceIR: MCPForgeIR,
): boolean {
  if (tool.kind === "endpoint")
    return READ_METHODS.has(tool.method.toUpperCase());
  return (
    tool.steps.length > 0 &&
    tool.steps.every((step) => {
      const endpoint = sourceIR.tools.find(
        (candidate) =>
          candidate.kind === "endpoint" &&
          (candidate.originalOperationId === step.operationId ||
            candidate.name === step.operationId),
      );
      return (
        endpoint?.kind === "endpoint" &&
        READ_METHODS.has(endpoint.method.toUpperCase())
      );
    })
  );
}

export function toolAnnotations(tool: ToolDefinition, sourceIR: MCPForgeIR) {
  const readOnlyHint = isReadOnlyTool(tool, sourceIR);
  return {
    readOnlyHint,
    destructiveHint: !readOnlyHint,
    idempotentHint: readOnlyHint,
    openWorldHint: true,
  };
}

/** The HTTP method policy is enforced by the generated runtime as well as tool selection. */
export function applyReadOnlyPolicy(
  ir: MCPForgeIR,
  sourceIR: MCPForgeIR = ir,
): MCPForgeIR {
  return {
    ...ir,
    executionPolicy: { readOnly: true },
    tools: ir.tools.filter((tool) => isReadOnlyTool(tool, sourceIR)),
  };
}
