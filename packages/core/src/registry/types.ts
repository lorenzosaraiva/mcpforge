import type { MCPForgeIR } from "../parser/types.js";

export interface RegistryIndex {
  version: string;
  entries: RegistryIndexEntry[];
}

export interface RegistryIndexEntry {
  slug: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  toolCount: number;
  tags: string[];
  optimized: boolean;
  workflowEnabled: boolean;
  publishedAt: string;
  entryFile: string;
}

export interface RegistryEntry extends RegistryIndexEntry {
  ir: MCPForgeIR;
  specSource?: string;
  sourceType: "openapi" | "docs-url";
  selectedTools: string[];
}
