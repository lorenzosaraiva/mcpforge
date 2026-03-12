# mcpforge

Generate MCP servers from OpenAPI specs or docs pages, then curate the public tool surface for agents.

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
- `mcpforge test` - Rebuild a generated server, verify registered tools, and smoke-test each public handler over stdio.

## Testing

```bash
npx mcpforge test --dir ./mcp-server-my-api
```

Dry-run mode validates `listTools` against `mcpforge.config.json` and calls each public tool with minimal inputs. Use `--live` only when the generated project has real auth configured.
