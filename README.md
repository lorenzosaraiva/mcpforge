# MCPForge

Generate production-ready MCP servers from any OpenAPI spec or API docs page in seconds.

[![npm version](https://img.shields.io/npm/v/mcpforge.svg)](https://www.npmjs.com/package/mcpforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Demo

![MCPForge Demo](./assets/demo.gif)

## Quick Start

From an OpenAPI spec:

```bash
npx mcpforge init https://api.example.com/openapi.json
```

From any API docs page (no spec needed):

```bash
npx mcpforge init --from-url https://docs.stripe.com/api
```

## Why MCPForge?

Tools like FastMCP and Stainless can auto-generate MCP servers from OpenAPI specs, but the output is often rough: hundreds of tools with bad descriptions that overwhelm LLMs. MCPForge uses AI to curate endpoints into a smaller set of well-named, well-described tools that work well with Claude, Cursor, and other MCP clients. Think of it as the difference between dumping a raw API spec on an assistant and briefing them on the 20 tools they actually need.

## What It Does

- Parses any OpenAPI 3.x spec into a clean MCP server
- No OpenAPI spec? Point MCPForge at a docs URL and it infers endpoints with AI
- Uses Claude to curate and optimize tools for LLM usage
- Detects spec drift and flags breaking changes with risk scoring
- Validates generated servers end to end with build, registration, and smoke tests
- Generates a complete, ready-to-use MCP server with auth, error handling, and docs

## Features

- **Smart OpenAPI parsing** - Converts endpoints into MCP-friendly tools with schema-aware inputs.
- **Docs URL inference** (`--from-url`) - Scrapes API docs pages and uses Claude to infer endpoints. No OpenAPI spec required.
- **AI-powered tool optimization** (`--optimize`) - Curates APIs to <=25 essential tools by default. GitHub (1,079 -> 25), Stripe (587 -> 25), Spotify (97 -> 25).
- **Strict and standard modes** - Strict mode (default) targets <=25 tools for focused LLM usage. Standard mode (`--standard`) allows up to 80 for broader coverage. Custom cap with `--max-tools <n>`.
- **Breaking change detection** (`diff`) - Compares the current spec against your last generation and flags changes as high, medium, or low risk.
- **Generated server testing** (`test`) - Rebuilds a generated project, validates registered tools over stdio, and smoke-tests each handler.
- **Multiple auth schemes** - Detects API key, bearer, OAuth2, and basic auth. Handles optional vs required auth gracefully.
- **Claude Desktop and Cursor ready** - Generated README includes copy-paste MCP config snippets.
- **Inspect and dry-run modes** - Understand a spec before generation and preview tools without writing files.

## Commands

- `mcpforge init <spec>` - Parse a spec, optionally optimize tools, and generate an MCP server project. Use `--from-url` when you only have docs. Use `--optimize` for AI curation. Use `--pick` to interactively choose which endpoints become tools, with AI suggestions pre-checked when combined with `--optimize`. Use `--dry-run` to preview without writing files.
- `mcpforge generate` - Regenerate from `mcpforge.config.json`. Saved tool selections are respected automatically. Use `--optimize` to re-run AI optimization and `--pick` to re-pick tools interactively.
- `mcpforge inspect <spec>` - Print API summary, endpoint groups by tag, and quality warnings.
- `mcpforge diff` - Compare the current spec against the last generation and flag breaking changes with risk scoring (high/medium/low).
- `mcpforge update` - Check for upstream spec changes and regenerate your server. Shows a diff summary and asks for confirmation on breaking changes. Use `--pick` to re-pick tools against the latest spec.
- `mcpforge test` - Rebuild a generated server, verify `listTools` matches `mcpforge.config.json`, and smoke-test every tool over stdio. Use `--dir <path>` to target a generated project explicitly, `--timeout <ms>` to control per-tool call timeouts, and `--live` to run real API calls using auth configured in the generated project's `.env`.

## AI Optimization

Use `--optimize` with `init` or `generate` to run Claude-based tool curation.

```bash
mcpforge init --optimize https://api.example.com/openapi.json
```

The optimizer analyzes your API and:

- Curates to <=25 essential tools by default (strict mode)
- Rewrites descriptions to be concise and LLM-friendly
- Removes noise (health checks, admin routes, deprecated endpoints)
- Prioritizes the most useful tools

Use `--standard` for broader coverage (up to 80 tools) or `--max-tools <n>` for a custom limit.

Requires `ANTHROPIC_API_KEY`. When missing, optimization is skipped and generation continues normally.

## Configuration

Generated projects include `mcpforge.config.json`, which stores the spec source, output directory, optimization mode, saved `selectedTools`, and the IR used for generation. Use this file with `mcpforge generate` to regenerate quickly after edits, or with `mcpforge diff` to detect upstream changes.

## Testing Generated Servers

Run the generated server checks from inside a generated project:

```bash
npx mcpforge test
```

Or point at a generated project from elsewhere:

```bash
npx mcpforge test --dir ./mcp-server-my-api
```

By default, `mcpforge test` is dry-run oriented:

- Runs `npm install` and `npm run build` in the generated project
- Starts the built server over stdio using the MCP SDK client
- Confirms every tool from `mcpforge.config.json` is registered with the expected schema
- Calls each tool with minimal inputs and treats structured handler errors as a pass
- Marks `401` and `403` responses as auth-required skips instead of failures

Use `--live` when you want to exercise the real upstream API. In live mode, MCPForge sends best-effort sample inputs for required fields and expects non-auth `2xx` responses. Make sure the generated project's `.env` is configured first.

## Tested APIs

MCPForge has been tested against diverse real-world API specs across different formats and edge cases.

| API | Format | Endpoints | Status |
|-----|--------|-----------|--------|
| Twilio | OpenAPI 3.x | 197 | yes |
| Kubernetes | Swagger 2.0 | 1,085 | yes |
| Discord | OpenAPI 3.1 | 229 | yes |
| Notion | OpenAPI 3.0 | 13 | yes |
| PandaDoc | OpenAPI 3.0 | 115 | yes |
| Adyen | OpenAPI 3.1 | 2 | yes |
| Slack | YAML (OpenAPI 3.0) | 174 | yes |
| api.video | OpenAPI 3.0 (circular refs) | 47 | yes |
| Amadeus | Swagger 2.0 | 1 | yes |

Supports OpenAPI 3.0, 3.1, Swagger 2.0, JSON and YAML formats, circular `$ref` schemas, and specs with missing operation IDs. Full report in [examples/compatibility-report.md](./examples/compatibility-report.md).

## Contributing

Contributions are welcome. Open an issue for bugs or ideas, or submit a PR with a focused change.

## License

MIT
