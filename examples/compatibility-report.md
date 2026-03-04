# MCPForge Compatibility Report (2026-03-04)

Test command shape used for every spec:
- `MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts inspect <spec>`
- `MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init <spec> --no-optimize -o <outdir>`
- `npm install && npm run build` inside generated project

| Spec | Format | Endpoints | Inspect | Init | Compiles | Notes |
|------|--------|-----------|---------|------|----------|-------|
| Twilio | JSON (OpenAPI 3.x) | 197 | PASS | PASS | PASS | 197 tools generated; deeply nested schemas parsed and compiled correctly. |
| Kubernetes | JSON (Swagger 2.0) | 1085 | PASS | PASS | PASS | 1085 tools generated; Swagger 2.0 parameters + request bodies now mapped. Base URL defaults to `http://localhost` because this spec does not define `host`/`servers`. |
| Discord | JSON (OpenAPI 3.1) | 229 | PASS | PASS | PASS | 229 tools generated; auth-heavy + circular refs handled. |
| Notion (community) | JSON (OpenAPI 3.0) | 13 | PASS | PASS | PASS | 13 tools generated from APIs.guru Notion spec. |
| PandaDoc | JSON (OpenAPI 3.0) | 115 | PASS | PASS | PASS | 115 tools generated. Used `https://developers.pandadoc.com/openapi/pandadoc-public-api.json` (the provided URL now returns 404). |
| Adyen BinLookup v54 | JSON (OpenAPI 3.1) | 2 | PASS | PASS | PASS | 2 tools generated; explicit OpenAPI 3.1 coverage. |
| Notion (operationIds removed) | JSON (OpenAPI 3.0) | 13 | PASS | PASS | PASS | 13 tools generated; all tool names correctly synthesized from method + path (`originalOperationId` missing for all operations). |
| Slack | YAML (OpenAPI 3.0) | 174 | PASS | PASS | PASS | 174 tools generated; YAML parsing path validated end-to-end. |
| api.video | JSON (OpenAPI 3.0, circular refs) | 47 | PASS | PASS | PASS | 47 tools generated; circular `$ref` graph handled without parse/init failures. |
| Amadeus Airline Code Lookup | JSON (Swagger 2.0) | 1 | PASS | PASS | PASS | 1 tool generated; Swagger 2.0 base URL resolved to `https://test.api.amadeus.com/v1`. |

## Bugs Fixed During Sweep

1. Circular `$ref` crash during parse/init (`Converting circular structure to JSON`).
   - Root cause: schema cloning relied on `JSON.stringify`, which fails on circular graphs.
   - Fix: replaced clone logic with cycle-safe deep clone in `schema-utils.ts`.
   - Validation: circular spec (`api.video`) now passes `inspect`, `init`, and compile.

2. Swagger 2.0 compatibility gaps (base URL, parameter schemas, request bodies, auth detection).
   - Root cause: parser assumed OpenAPI 3-only structures (`servers`, `components.securitySchemes`, `requestBody`, `parameter.schema`).
   - Fixes in `openapi-parser.ts`:
     - Resolve Swagger 2.0 base URL from `schemes + host + basePath`.
     - Read auth schemes from `securityDefinitions` when `components.securitySchemes` is absent.
     - Parse Swagger 2.0 `body` and `formData` parameters into request bodies.
     - Parse Swagger 2.0 non-body parameter types from top-level parameter fields.
   - Validation: Kubernetes and Amadeus Swagger 2.0 specs now initialize and compile with improved tool schemas.

3. Large-spec generation instability (`EMFILE: too many open files`) on very large specs.
   - Root cause: generator opened too many files in parallel and re-read templates for each tool file.
   - Fixes in `typescript-generator.ts`:
     - Added template compilation cache.
     - Batched tool handler writes with bounded concurrency.
   - Validation: large specs in this matrix (Kubernetes/Twilio/Discord) generate and compile successfully.
