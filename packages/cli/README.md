# mcpforge

Generate production-ready MCP servers from OpenAPI specs.

## Usage

```bash
npx mcpforge init https://api.example.com/openapi.json
```

## Commands

- `mcpforge init <spec>` - Parse a spec and generate an MCP server project.
- `mcpforge generate` - Regenerate from `mcpforge.config.json`.
- `mcpforge inspect <spec>` - Inspect a spec without generating files.
- `mcpforge diff` - Compare the current upstream spec against the last generated IR.
- `mcpforge update` - Refresh from upstream changes and regenerate in place.
- `mcpforge test` - Rebuild a generated server, verify registered tools, and smoke-test each handler over stdio.

## Testing

```bash
npx mcpforge test --dir ./mcp-server-my-api
```

Dry-run mode rebuilds the generated project, validates `listTools` against `mcpforge.config.json`, and calls each tool with minimal inputs. Use `--live` to send best-effort real inputs and expect successful upstream responses with auth loaded from the generated project's `.env`.
