# MCPForge ⚒️

Generate production-ready MCP servers from any OpenAPI spec — or any API docs page — in seconds.

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

Tools like FastMCP and Stainless can auto-generate MCP servers from OpenAPI specs, but the output is rough — hundreds of tools with bad descriptions that overwhelm LLMs. MCPForge uses AI to curate endpoints into a smaller set of well-named, well-described tools that actually work well with Claude, Cursor, and other MCP clients. Think of it as the difference between dumping a raw API spec on an assistant vs. briefing them on the 20 tools they actually need.

## What It Does

- Parses any OpenAPI 3.x spec into a clean MCP server
- No OpenAPI spec? Point MCPForge at any docs URL and it infers endpoints with AI
- Uses Claude to curate and optimize tools for LLM usage
- Detects spec drift and flags breaking changes with risk scoring
- Generates a complete, ready-to-use MCP server with auth, error handling, and docs

## Features

- **Smart OpenAPI parsing** — Converts endpoints into MCP-friendly tools with schema-aware inputs.
- **Docs URL inference** (`--from-url`) — Scrapes API docs pages and uses Claude to infer endpoints. No OpenAPI spec required.
- **AI-powered tool optimization** (`--optimize`) — Aggressively curates APIs to ≤25 essential tools by default. GitHub (1,079 → 25), Stripe (587 → 25), Spotify (97 → 25).
- **Strict and standard modes** — Strict mode (default) targets ≤25 tools for focused LLM usage. Standard mode (`--standard`) allows up to 80 for broader coverage. Custom cap with `--max-tools <n>`.
- **Breaking change detection** (`diff`) — Compares the current spec against your last generation and flags changes as high, medium, or low risk.
- **Multiple auth schemes** — Detects API key, bearer, OAuth2, and basic auth. Handles optional vs required auth gracefully.
- **Claude Desktop & Cursor ready** — Generated README includes copy-paste MCP config snippets.
- **Inspect & dry-run modes** — Understand a spec before generation and preview tools without writing files.

## Commands

- `mcpforge init <spec>` — Parse a spec, optionally optimize tools, and generate an MCP server project. Use `--from-url` when you only have docs. Use `--optimize` for AI curation. Use `--dry-run` to preview without writing files.
- `mcpforge generate` — Regenerate from `mcpforge.config.json`. Use `--optimize` to re-run AI optimization.
- `mcpforge inspect <spec>` — Print API summary, endpoint groups by tag, and quality warnings.
- `mcpforge diff` — Compare current spec against last generation and flag breaking changes with risk scoring (high/medium/low).
- `mcpforge update` — Check for upstream spec changes and regenerate your server. Shows a diff summary and asks for confirmation on breaking changes.
- `mcpforge test` — Placeholder for upcoming testing workflows.

## AI Optimization

Use `--optimize` with `init` or `generate` to run Claude-based tool curation.

```bash
mcpforge init --optimize https://api.example.com/openapi.json
```

The optimizer analyzes your API and:
- Curates to ≤25 essential tools by default (strict mode)
- Rewrites descriptions to be concise and LLM-friendly
- Removes noise (health checks, admin routes, deprecated endpoints)
- Prioritizes the most useful tools

Use `--standard` for broader coverage (up to 80 tools) or `--max-tools <n>` for a custom limit.

Requires `ANTHROPIC_API_KEY`. When missing, optimization is skipped and generation continues normally.

## Configuration

Generated projects include `mcpforge.config.json`, which stores the spec source, output directory, optimization mode, and the IR used for generation. Use this file with `mcpforge generate` to regenerate quickly after edits, or with `mcpforge diff` to detect upstream changes.

## Tested APIs

MCPForge has been tested against 10 diverse real-world API specs across different formats and edge cases.

| API | Format | Endpoints | Status |
|-----|--------|-----------|--------|
| Twilio | OpenAPI 3.x | 197 | ✅ |
| Kubernetes | Swagger 2.0 | 1,085 | ✅ |
| Discord | OpenAPI 3.1 | 229 | ✅ |
| Notion | OpenAPI 3.0 | 13 | ✅ |
| PandaDoc | OpenAPI 3.0 | 115 | ✅ |
| Adyen | OpenAPI 3.1 | 2 | ✅ |
| Slack | YAML (OpenAPI 3.0) | 174 | ✅ |
| api.video | OpenAPI 3.0 (circular refs) | 47 | ✅ |
| Amadeus | Swagger 2.0 | 1 | ✅ |

Supports OpenAPI 3.0, 3.1, Swagger 2.0, JSON and YAML formats, circular `$ref` schemas, and specs with missing operationIds. Full report in [examples/compatibility-report.md](./examples/compatibility-report.md).

## Contributing

Contributions are welcome. Open an issue for bugs or ideas, or submit a PR with a focused change.

## License

MIT
