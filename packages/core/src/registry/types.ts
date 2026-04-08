import type { MCPForgeIR } from "../parser/types.js";

export interface RegistryVerificationSummary {
  status: "passed" | "failed";
  mode: "mock" | "live";
  verifiedAt: string;
  compatibilityVersion: string;
  toolCount?: number;
  passedToolCount?: number;
  skippedToolCount?: number;
  failedToolCount?: number;
}

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
  verification?: RegistryVerificationSummary;
  entryFile: string;
}

export interface RegistryEntry extends RegistryIndexEntry {
  ir: MCPForgeIR;
  specSource?: string;
  sourceType: "openapi" | "docs-url";
  selectedTools: string[];
}
