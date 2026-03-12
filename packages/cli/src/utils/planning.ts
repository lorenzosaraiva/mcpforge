import { type MCPForgeIR, planWorkflowTools } from "../core.js";
import {
  applyOptimizedToolSuggestions,
  deriveSuggestedSelectionValues,
  filterIRBySelectedTools,
  getAllToolSelectionValues,
} from "./tool-selection.js";

interface PlanningOptions {
  sourceIR: MCPForgeIR;
  optimizedIR?: MCPForgeIR;
  workflowEnabled?: boolean;
  maxTools?: number;
}

export function buildCandidateIR(options: PlanningOptions): MCPForgeIR {
  const optimizedSource = applyOptimizedToolSuggestions(options.sourceIR, options.optimizedIR);

  if (!options.workflowEnabled) {
    return optimizedSource;
  }

  return planWorkflowTools(optimizedSource, {
    maxTools: options.maxTools,
    preferredOperationIds: options.optimizedIR?.tools.map((tool) => tool.originalOperationId ?? tool.name),
  });
}

export function getDefaultSelectedTools(options: PlanningOptions): string[] {
  if (options.workflowEnabled) {
    return getAllToolSelectionValues(buildCandidateIR(options));
  }

  return options.optimizedIR
    ? deriveSuggestedSelectionValues(options.sourceIR, options.optimizedIR)
    : getAllToolSelectionValues(options.sourceIR);
}

export function buildFinalIR(
  options: PlanningOptions & {
    selectedTools?: readonly string[];
  },
): MCPForgeIR {
  return filterIRBySelectedTools(buildCandidateIR(options), options.selectedTools);
}
