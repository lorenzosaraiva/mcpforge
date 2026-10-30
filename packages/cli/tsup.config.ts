import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  dts: false,
  shims: true,
  noExternal: ["@mcpforge/core"],
  external: [
    "ajv",
    "ajv-formats",
    "@anthropic-ai/sdk",
    "@apidevtools/swagger-parser",
    "@clack/prompts",
    "commander",
    "cross-spawn",
    "handlebars",
    "zod",
  ],
});
