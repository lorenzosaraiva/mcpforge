# MCPForge

Generate production-ready MCP servers from any OpenAPI spec in seconds.

<!-- demo gif here -->

## Quick Start

```bash
npx mcpforge init https://api.example.com/openapi.json
```

## What It Does

- Parses OpenAPI 3.x specs into MCP-ready tool definitions.
- Optionally uses Claude to curate and optimize tools for LLM usage.
- Generates a complete TypeScript MCP server with auth scaffolding, error handling, and docs.

## Features

- Smart OpenAPI parsing
- AI-powered tool optimization (strict mode default): GitHub 1,079 -> 25, Stripe 587 -> 25, Spotify 97 -> 25
- Strict mode by default (`--strict`): targets <=25 essential tools
- Standard mode available (`--standard`): broader coverage, capped at <=80 tools
- Custom cap override (`--max-tools <n>`)
- Multiple auth schemes (none, API key, bearer, OAuth2, basic)
- Claude Desktop and Cursor ready output
- Inspect mode and dry-run mode
- Spec drift detection with `mcpforge diff`
- Docs URL inference (`--from-url`) when no OpenAPI spec is available

## Commands

- `mcpforge init <spec>`: Parse spec and generate server. Supports `--optimize`, `--dry-run`, `--strict`, `--standard`, `--max-tools`.
- `mcpforge init --from-url <docs-url>`: Infer API from docs pages with Claude, then generate.
- `mcpforge generate`: Regenerate from `mcpforge.config.json`. Supports `--optimize`, `--strict`, `--standard`, `--max-tools`.
- `mcpforge inspect <spec>`: Print API summary, endpoint groups, and warnings.
- `mcpforge diff`: Compare upstream spec changes against last generated IR with risk scoring.
- `mcpforge test`: Placeholder command.

## AI Optimization

Use optimization during `init` or `generate`:

```bash
mcpforge init --optimize https://api.example.com/openapi.json
```

Strict mode is now default and aggressively curates to a small, practical toolset for LLMs. Use `--standard` when you need broader endpoint coverage.

## Configuration

Generated projects include `mcpforge.config.json` with:

- `specSource`
- `sourceType`
- `outputDir`
- `optimized`
- `optimizerMode`
- `maxTools`
- `ir`

## Contributing

Contributions are welcome. Open an issue or submit a focused PR.

## License

MIT
