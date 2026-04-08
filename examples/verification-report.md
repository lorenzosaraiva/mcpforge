# MCPForge Verification Report Example

Sample command:

```bash
npx mcpforge test
```

Sample result:

```text
mcpforge test

Build check
  npm install (3.2s)
  npm run build (1.1s)

Server connection
  MCP server started on stdio

Tool registration (4 tools)
  All 4 tools registered correctly

Tool compatibility tests
  find_customers.......... pass (compatibility pass)
  create_customer......... pass (compatibility pass)
  update_customer......... pass (compatibility pass)
  delete_customer......... pass (compatibility pass)

Results: 4/4 passed
```

Verification metadata written to `mcpforge.config.json`:

```json
{
  "verification": {
    "status": "passed",
    "mode": "mock",
    "verifiedAt": "2026-04-08T12:00:00.000Z",
    "compatibilityVersion": "1",
    "finalIRHash": "sha256:example",
    "toolCount": 4,
    "passedToolCount": 4,
    "skippedToolCount": 0,
    "failedToolCount": 0
  }
}
```

Publishing behavior:

- `mcpforge publish` succeeds when verification is fresh and passed.
- `mcpforge publish` fails by default when verification is missing, stale, or failed.
- `mcpforge publish --allow-unverified` bypasses the gate explicitly.
