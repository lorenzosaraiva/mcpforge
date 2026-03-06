# Changelog

## 0.2.0 (unreleased)

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
