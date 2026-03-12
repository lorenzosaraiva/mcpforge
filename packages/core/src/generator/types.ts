import type { MCPForgeIR } from "../parser/types.js";

export interface GenerateProjectOptions {
  outputDir: string;
  projectName?: string;
  overwrite?: boolean;
  specSource?: string;
  optimized?: boolean;
  irForConfig?: MCPForgeIR;
  sourceIR?: MCPForgeIR;
}

export interface GenerateProjectResult {
  outputDir: string;
  fileCount: number;
  generatedToolCount: number;
}
