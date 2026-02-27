# MCPForge ⚒️

Generate production-ready MCP servers from any OpenAPI spec in seconds.

<!-- demo gif here -->

## Quick Start

```bash
npx mcpforge init https://api.example.com/openapi.json
```

## What It Does

- Parses any OpenAPI 3.x spec
- Optionally uses AI to curate and optimize tools for LLM usage
- Generates a complete, ready-to-use MCP server with auth, error handling, and docs

## Features

- Smart OpenAPI parsing
  - Converts endpoints into MCP-friendly tools with schema-aware inputs.
- AI-powered tool optimization (via Claude)
  - Curates noisy endpoint lists into clearer, higher-value tools for assistants.
- Multiple auth schemes
  - Detects API key, bearer, OAuth2, basic auth, and handles optional vs required auth.
- Claude Desktop & Cursor ready
  - Generated README includes copy-paste MCP config snippets.
- Inspect & dry-run modes
  - Understand a spec before generation and preview tools without writing files.

## Commands

- `mcpforge init <spec>`
  - Parse a spec, optionally optimize tools, and generate an MCP server project.
- `mcpforge generate`
  - Regenerate from `mcpforge.config.json` (use `--optimize` to re-run AI optimization).
- `mcpforge inspect <spec>`
  - Print API summary, endpoint groups by tag, and quality warnings.
- `mcpforge test`
  - Placeholder command for upcoming testing workflows.

## AI Optimization

Use `--optimize` with `init` or `generate` to run Claude-based tool curation.

```bash
mcpforge init --optimize https://api.example.com/openapi.json
```

When `ANTHROPIC_API_KEY` is missing, optimization is skipped and generation continues.

## Configuration

Generated projects include `mcpforge.config.json`, which stores:

- Spec source
- Output directory
- Whether optimization was used
- The IR used for generation

Use this file with `mcpforge generate` to regenerate quickly after edits.

## Contributing

Contributions are welcome. Open an issue for bugs/ideas, or submit a PR with a focused change.

## License

MIT
