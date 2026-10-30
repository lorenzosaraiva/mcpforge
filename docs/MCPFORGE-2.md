# MCPForge 2.0 release candidate

MCPForge takes an OpenAPI specification to generated tools, verifies their requests against a local mock API, and registers the server with your MCP client. The candidate requires Node 22.19 or later. The repository's `.nvmrc` selects Node 24.

From this checkout, run `npm ci` and `npm run build`. Use `npm run dev -- <command>` or `node packages/cli/dist/index.js <command>` for the commands below until the candidate is published to npm.

## Connect

```sh
mcpforge connect ./openapi.yaml --client cursor --read-only
mcpforge connect ./generated-server --client claude-desktop --scope user
mcpforge connect ./generated-server --client vscode --scope project
mcpforge connect ./generated-server --client vscode --format native
```

Each command previews the entry and destination, verifies the generated server, prompts for missing credentials, backs up an existing client file, and merges only the requested entry. `--yes` permits non-interactive application; `--skip-credentials` leaves credential variables for local setup. A successful mock check does not validate real provider credentials or prove the application loaded its tools. Reload/enable the server in the client and perform a suitable read-only first task.

Credential prompts follow the selected operations: public routes need none, and an operation with alternative authentication schemes uses one minimal allowed alternative. Combined schemes in that alternative require all corresponding variables. Existing `.env` files are preserved for local review.

| Client | Project scope | User scope | Configuration root |
| --- | --- | --- | --- |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` |
| Claude Desktop | Not supported | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%/Claude/claude_desktop_config.json` | `mcpServers` |
| VS Code, portable | `.mcp.json` | `$COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json` | `mcpServers` |
| VS Code, native Local harness | `.vscode/mcp.json` | Explicit `--config` required for profile-specific paths | `servers`, with `type: stdio` |

VS Code's current guidance recommends the portable configuration. Workspace-root support can require its experimental workspace-root setting; native Local harness configuration remains supported but is labeled deprecated in the guided flow. Check which harness is active. [VS Code documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

`--config <path>` overrides the destination, which is also useful for custom profiles and tests. Claude Desktop on Linux requires this explicit location. `--scope project` is rejected for Claude Desktop. See [Cursor configuration](https://cursor.com/docs/mcp) and [Claude Desktop setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers) for application-side loading and restart steps.

JSONC comments, unrelated entries, and settings are preserved. Malformed JSON/JSONC and conflicting names stop setup. Backups preserve the exact original bytes with private POSIX permissions; Windows uses directory ACLs. Credentials remain in the generated server's ignored `.env` and are not copied into client JSON or connection records.

## Diagnose

```sh
# Inspection reads configuration/files, but does not install, build, start, or call anything.
mcpforge doctor --dir ./generated-server
mcpforge doctor --dir ./generated-server --json

# Explicit execution: may install packages, builds the server, and starts local processes.
mcpforge doctor --dir ./generated-server --verify
mcpforge doctor --dir ./generated-server --verify --skip-install --json
```

`doctor` distinguishes configuration, Node support, generation identity, dependency presence, build presence, credential presence, verification freshness, managed client registration, and application loading. Inspection skips handshake, schema, and request checks; `--verify` executes them against a local mock upstream. Credentials are inspected for presence, not validity, and their values are never emitted. Build-script output is not embedded in diagnostic JSON because it can contain secrets; run the suggested local compiler command for details.

The JSON contract has `schemaVersion: 1`, `mode`, `ok`, and `checks`. Every check has `id`, `status` (`passed`, `failed`, or `skipped`), `required`, and `message`, with `remediation` on failures. A failed required check sets exit status 1. Registration-file presence cannot prove client loading; `client.loaded` remains explicitly skipped until the user checks the application.

Verification records include the final IR hash, template identity, runtime version, and a fingerprint of generated source, built code, package metadata, and dependency lock. Changing executable code invalidates an old receipt. Credential files, client settings, and source maps are excluded from this fingerprint. Unsupported mock operations are listed as skipped; an all-skipped run fails.

## Move, repair, and disconnect

```sh
mcpforge connect "./moved server" --client cursor --repair
mcpforge disconnect --name mcpforge-example --client cursor --dry-run
mcpforge disconnect --name mcpforge-example --client cursor --yes
```

`--repair` can replace a managed entry only while it still equals the entry MCPForge recorded. It cannot replace an entry modified by another owner. Connection records are stored in the generated directory and beside the client configuration (`<config>.mcpforge-connections.json`); the latter survives deletion of the generated project and permits disconnection. Records contain paths and launch settings, never credentials. Disconnect backs up the client file, removes only the matching entry, and retains server files and `.env`.

For an explicit destination, supply the same `--client`, `--scope`, `--format`, and `--config` values when repairing or disconnecting. Concurrent edits after preview stop application instead of overwriting the newer configuration. An interrupted connection can leave a record without a registration; `doctor` reports the mismatch, and reconnect/disconnect can reconcile it.

## Read-only policy

`init`, `connect`, `generate`, and `update` accept `--read-only`. The policy selects only GET, HEAD, and OPTIONS endpoints, excludes workflows with unknown or write dependencies, persists across regeneration/update, and blocks writes in the generated runtime before authentication or network calls. `MCPFORGE_READ_ONLY=1` also enables the runtime guard and hides write tools on an existing server.

HTTP method semantics are a useful boundary, not proof that an upstream service is side-effect free. MCP annotations are conservative descriptions, not authorization rules. Client approvals remain with the client. See the [MCP annotation trust rules](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations).

## Migrate from 1.x

1. Upgrade Node to 22.19+ and install the candidate.
2. Back up customized generated source and client settings.
3. In the generated project, run `mcpforge generate`; this rewrites generated files and installs the current runtime/template manifest. Restore reviewed customizations afterward.
4. Run `mcpforge doctor --verify` and fix required failures. Run `connect` to create managed client records for older manually configured setups; collisions require another name or manual review.

Old verification receipts become stale; they are not silently certified under the new model. Existing registry entries with older compatibility receipts remain readable and display a legacy report. Current registry reports state mock/live mode and skipped-tool counts.

The core AI options no longer accept `temperature` because the Anthropic SDK's current Messages API removed it. Set `MCPFORGE_AI_MODEL` or the core `model` option to select an explicit model; the current default is `claude-sonnet-5-5`. The AI migration has mocked request/response contract tests. [Anthropic API migration](https://platform.claude.com/docs/en/api/migration-2026-10-21).

## Candidate release gates

Automated build, coverage, audit, packed-artifact, platform, and task-pack contract checks must pass. Model selection/request evaluation is separate from full task completion. Five external users must still attempt setup and at least four must complete a first task without editing client JSON before calling the onboarding milestone complete. Use [the trial protocol](./ONBOARDING-TRIAL.md); no trial results are implied by automated tests.
