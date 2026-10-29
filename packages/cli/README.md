# mcpforge

Generate, curate, and verify MCP servers from OpenAPI specs or documentation pages.

## Common Usage

Connect an OpenAPI spec to the current Cursor project:

```bash
npx mcpforge connect ./openapi.yaml --client cursor
```

Previews the entry, generates/builds/verifies the server against a mock API, prompts for credentials, and preserves other entries when updating `.cursor/mcp.json`. Credentials stay in the server's ignored `.env` file. Enable/reload the server in Cursor after setup; real authentication is not tested.

Use `--dry-run` for a preview, `--project-dir <dir>` to target another Cursor project, or pass an existing generated directory to resume. Non-interactive setup requires `--yes`; use `--skip-install` only when dependencies are already installed. Existing server names with different settings are preserved: choose another `--name`.

Generate curated workflow tools from a spec:

```bash
npx mcpforge init --optimize --workflows https://api.example.com/openapi.json
```

Preview the plan without writing files:

```bash
npx mcpforge init --dry-run --optimize --workflows https://api.example.com/openapi.json
```

## Commands

- `mcpforge connect <spec-or-directory>` - Generate or resume a server, verify its tools, and configure Cursor. Supports `--optimize`, `--workflows`, `--pick`, and `--skip-credentials`.
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
