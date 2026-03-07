import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node18",
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  dts: false,
  shims: false,
  external: [
    "@anthropic-ai/sdk",
    "@apidevtools/swagger-parser",
    "@clack/prompts",
    "@modelcontextprotocol/sdk",
    "commander",
    "handlebars",
    "zod",
  ],
});
