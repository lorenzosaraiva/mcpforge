# mcpforge

Generate, curate, and verify MCP servers from OpenAPI specs or documentation pages.

The 2.0 release candidate requires Node.js 22.19+. It adds managed connections for Cursor, Claude Desktop, and VS Code, read-only generation, runtime-bound verification, and lifecycle diagnostics. Install with `npm install -g mcpforge@2.0.0-rc.1` only after the candidate is published; until then build the repository checkout and use `npm run dev -- <command>`.

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

- `mcpforge connect <spec-or-directory>` - Generate or resume a server, verify its tools, and configure Cursor, Claude Desktop, or VS Code. Supports explicit `--scope`, `--config`, `--format`, `--repair`, `--read-only`, `--optimize`, `--workflows`, `--pick`, and `--skip-credentials`.
- `mcpforge doctor --dir <project> [--json]` - Inspect files and credential presence without starting processes or making requests. Add `--verify` to install/build/launch and run mock checks explicitly.
- `mcpforge disconnect --name <server> --client <client>` - Remove an unchanged managed client entry with a backup; preserve generated files and credentials.
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

Requires Node.js 22.19 or newer. See the [2.0 guide](https://github.com/lorenzosaraiva/mcpforge/blob/main/docs/MCPFORGE-2.md) for client paths, verification levels, read-only policy, and migration.
