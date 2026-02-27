import type { MCPForgeIR } from "../parser/types.js";

export interface OptimizationOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  logger?: (message: string) => void;
}

export interface OptimizationResult {
  optimizedIR: MCPForgeIR;
  skipped: boolean;
  reason?: string;
}
