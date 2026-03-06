import type { MCPForgeIR, ToolDefinition } from "../core.js";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getOperationId(tool: ToolDefinition): string | undefined {
  const operationId = tool.originalOperationId?.trim();
  return operationId ? operationId : undefined;
}

function getMethodPath(tool: ToolDefinition): string {
  return `${tool.method.toUpperCase()} ${tool.path}`;
}

function getSelectionCandidates(tool: ToolDefinition): string[] {
  const candidates = [tool.name, getMethodPath(tool)];
  const operationId = getOperationId(tool);
  if (operationId) {
    candidates.unshift(operationId);
  }
  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))];
}

function getLookupKeys(tool: ToolDefinition): string[] {
  const keys = [`method-path:${normalize(getMethodPath(tool))}`, `name:${normalize(tool.name)}`];
  const operationId = getOperationId(tool);
  if (operationId) {
    keys.unshift(`operation:${normalize(operationId)}`);
  }
  return keys;
}

function matchesSelectedTool(tool: ToolDefinition, selected: Set<string>): boolean {
  return getSelectionCandidates(tool).some((candidate) => selected.has(normalize(candidate)));
}

function findSuggestedTool(
  tool: ToolDefinition,
  byOperationId: Map<string, ToolDefinition>,
  byMethodPath: Map<string, ToolDefinition>,
  byName: Map<string, ToolDefinition>,
): ToolDefinition | undefined {
  const operationId = getOperationId(tool);
  if (operationId) {
    const byId = byOperationId.get(normalize(operationId));
    if (byId) {
      return byId;
    }
  }

  const byPath = byMethodPath.get(normalize(getMethodPath(tool)));
  if (byPath) {
    return byPath;
  }

  return byName.get(normalize(tool.name));
}

export function getToolSelectionValue(tool: ToolDefinition): string {
  return getOperationId(tool) ?? tool.name;
}

export function getAllToolSelectionValues(ir: MCPForgeIR): string[] {
  return ir.tools.map((tool) => getToolSelectionValue(tool));
}

export function resolveSelectedToolsForIR(ir: MCPForgeIR, selectedTools?: readonly string[]): string[] {
  if (selectedTools === undefined) {
    return getAllToolSelectionValues(ir);
  }

  const selected = new Set(selectedTools.map((value) => normalize(value)));
  return ir.tools
    .filter((tool) => matchesSelectedTool(tool, selected))
    .map((tool) => getToolSelectionValue(tool));
}

export function filterIRBySelectedTools(ir: MCPForgeIR, selectedTools?: readonly string[]): MCPForgeIR {
  if (selectedTools === undefined) {
    return ir;
  }

  const selected = new Set(selectedTools.map((value) => normalize(value)));
  return {
    ...ir,
    tools: ir.tools.filter((tool) => matchesSelectedTool(tool, selected)),
  };
}

export function deriveSuggestedSelectionValues(sourceIR: MCPForgeIR, suggestedIR: MCPForgeIR): string[] {
  const suggestedKeys = new Set(
    suggestedIR.tools.flatMap((tool) => getLookupKeys(tool)).map((key) => normalize(key)),
  );

  return sourceIR.tools
    .filter((tool) => getLookupKeys(tool).some((key) => suggestedKeys.has(normalize(key))))
    .map((tool) => getToolSelectionValue(tool));
}

export function applyOptimizedToolSuggestions(sourceIR: MCPForgeIR, optimizedIR?: MCPForgeIR): MCPForgeIR {
  if (!optimizedIR) {
    return sourceIR;
  }

  const byOperationId = new Map<string, ToolDefinition>();
  const byMethodPath = new Map<string, ToolDefinition>();
  const byName = new Map<string, ToolDefinition>();

  for (const tool of optimizedIR.tools) {
    const operationId = getOperationId(tool);
    if (operationId) {
      byOperationId.set(normalize(operationId), tool);
    }
    byMethodPath.set(normalize(getMethodPath(tool)), tool);
    byName.set(normalize(tool.name), tool);
  }

  return {
    ...sourceIR,
    tools: sourceIR.tools.map((tool) => {
      const suggested = findSuggestedTool(tool, byOperationId, byMethodPath, byName);
      if (!suggested) {
        return tool;
      }

      return {
        ...tool,
        ...suggested,
        method: tool.method,
        path: tool.path,
        originalOperationId: tool.originalOperationId ?? suggested.originalOperationId,
        tags: suggested.tags.length > 0 ? suggested.tags : tool.tags,
      };
    }),
  };
}
