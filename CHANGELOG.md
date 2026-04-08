# Changelog

## Unreleased

- Added generated-runtime support for header/query/cookie API keys plus content-type-aware request serialization for JSON, urlencoded, multipart, text, and binary payloads.
- Added compatibility verification metadata to `mcpforge.config.json`, including IR hashing and freshness checks.
- Upgraded `mcpforge test` from a smoke test to a compatibility harness that validates generated requests against a local mock upstream.
- Added a publish gate that requires a fresh successful verification run by default, with `--allow-unverified` as an explicit override.
- Added verification metadata to registry entries and surfaced verification state in `search` and `add`.
- Updated generated project docs and repo docs to document the verified compatibility matrix and current OAuth limitation.

## 1.0.0 (2026-04-01)

- Added the MCPForge registry scaffold under `registry/`, including `registry.json`, per-entry payloads, and registry contribution guidance.
- Added registry-aware CLI commands: `auth`, `publish`, `add`, and `search`.
- Added GitHub credential storage plus publish flows for direct owner pushes or fork-and-PR publishing.
- Added registry metadata to `mcpforge.config.json` and preserved it across `generate` and `update`.
- Added post-update re-publish prompting for projects that already have a published registry slug.
- Added Vitest coverage for credentials, registry install flows, registry publish flows, and registry search filtering.

- Added task-oriented workflow planning with `--workflows`, including deterministic workflow execution in generated servers.
- Added workflow-aware regeneration, diffing, and update impact reporting.
- Added generated-server runtime support for workflow handlers plus endpoint fallbacks.
- Added repo-level Vitest coverage and a GitHub Actions CI workflow.
- Added interactive `--pick` support to `init`, `generate`, and `update`, including large-API tag picking and optimizer-backed default selections.
- Persisted `selectedTools` plus source/optimized IR snapshots in config so later regenerations keep the chosen tool subset.
- Added optimizer `strict` mode as the default behavior.
- Added optimizer `standard` mode for broader coverage.
- Added configurable tool cap with `maxTools` and CLI `--max-tools`.
- Added CLI flags `--strict` and `--standard` to `init` and `generate`.
- Added `update` command to combine upstream diffing and in-place regeneration with high-risk confirmation, non-interactive safeguards, and dry-run/force controls.
- Improved large-API optimizer resilience with chunk tuning and JSON retry handling.
- Persisted optimizer settings in config (`optimizerMode`, `maxTools`).
- Fixed circular `$ref` schema handling in parser/schema normalization.
- Improved Swagger 2.0 compatibility:
  - Resolve base URL from `schemes`/`host`/`basePath`.
  - Detect auth from `securityDefinitions`.
  - Map `body` and `formData` parameters into request bodies.
  - Map non-body parameter types from Swagger 2.0 parameter objects.
- Hardened code generation for large specs by caching templates and batching tool file writes to avoid `EMFILE` failures.

## 0.1.0

- Initial release
- OpenAPI 3.x parsing and MCP server generation
- AI-powered tool optimization via Claude API
- CLI with init, generate, inspect, and test commands
- Added `diff` command for detecting breaking changes in upstream API specs
- Risk scoring system (high/medium/low) for categorizing changes
- Added `init --from-url` mode to infer API structure from documentation pages using Claude
- Added docs scraper + AI inference pipeline for APIs without public OpenAPI specs
- TypeScript server generation with stdio transport
- Auth detection and scaffolding
- Claude Desktop and Cursor configuration in generated README
