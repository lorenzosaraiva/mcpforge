# mcpforge

Generate, curate, and verify MCP servers from OpenAPI specs or documentation pages.

## Common Usage

Generate curated workflow tools from a spec:

```bash
npx mcpforge init --optimize --workflows https://api.example.com/openapi.json
```

Preview the plan without writing files:

```bash
npx mcpforge init --dry-run --optimize --workflows https://api.example.com/openapi.json
```

## Commands

- `mcpforge init <spec>` - Parse a spec or docs URL and generate a project. Use `--optimize`, `--workflows`, `--pick`, and `--dry-run` as needed.
- `mcpforge generate` - Regenerate from `mcpforge.config.json`, preserving saved workflow and optimization settings.
- `mcpforge inspect <spec>` - Inspect a spec and preview workflow planning with `--workflows`.
- `mcpforge diff` - Compare stored source IR against the latest upstream version and report risk-scored changes.
- `mcpforge update` - Refresh from upstream changes and regenerate in place.
- `mcpforge test` - Rebuild a generated server, verify registered tools, and validate each public handler against a local mock upstream over stdio.
- `mcpforge auth` - Manage GitHub credentials for publishing.
- `mcpforge publish` - Publish a freshly verified generated server to the registry.
- `mcpforge search` / `mcpforge add` - Browse and install registry servers.

## Testing

```bash
npx mcpforge test --dir ./mcp-server-my-api
```

Mock mode validates `listTools` input/output schemas, path/query/header construction, operation-specific authentication, OAuth token acquisition, supported body encodings, and schema-valid structured responses. Use `--live` only when the generated project has real credentials configured.

Requires Node.js 20 or newer.
