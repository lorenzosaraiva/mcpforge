import type { MCPForgeIR } from "../parser/types.js";

export type OptimizerMode = "standard" | "strict";

export interface OptimizationOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: OptimizerMode;
  maxTools?: number;
  maxEndpointsForOptimization?: number;
  optimizationChunkSize?: number;
  preferredTagsForOptimization?: string[];
  logger?: (message: string) => void;
}

export interface OptimizationResult {
  optimizedIR: MCPForgeIR;
  skipped: boolean;
  reason?: string;
}
