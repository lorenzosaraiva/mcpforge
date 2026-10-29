# MCPForge roadmap

Updated: 2026-10-29. Proposed next major milestone: **MCPForge 2.0 — verified API connections**.

## Product outcome

Give MCPForge an OpenAPI spec, choose a client, and get useful tools running with a clear answer to three questions: what was verified, which credentials are still needed, and how to fix a failed connection.

The intended release demo is:

```sh
mcpforge connect ./openapi.yaml --client cursor
mcpforge doctor --dir ./mcp-server-example
mcpforge disconnect --name mcpforge-example --client cursor
```

`doctor` and `disconnect` above are proposed commands. The recovered 1.2.0 `connect` implementation supports Cursor only. It checks generated requests against a local mock API; it does not establish that a real API credential works or that a client has loaded the server.

## Starting point

- OpenAPI/Swagger parsing, endpoint curation, deterministic workflows, structured outputs, and workflow-aware drift detection already exist.
- Verification can build and launch a generated server and compare its requests with a mock upstream. Publishing requires fresh successful verification by default.
- The recovered Cursor connection flow supplies a useful first version: preview, generate/resume, verify, collect credentials, and merge client configuration with a backup.
- Existing optimizer reports measure tool-count reduction. They do not yet demonstrate improved task completion. The registry currently contains one Stripe fixture, not a broad catalog of independently verified integrations.

The next investment should connect these capabilities into a reliable user journey and measure real usefulness.

## Delivery sequence

| Phase | Deliverable | Completion evidence |
| --- | --- | --- |
| 1. Connection lifecycle | `doctor`, a non-secret connection record, repair guidance, and `disconnect` for Cursor. Add `--json` diagnostics and distinguish build, MCP handshake, schema, mock request, credential presence, and client-registration checks. | Packed-CLI tests cover a fresh connection, reconnect, moved/deleted server, stale verification, failed build, changed client config, and disconnect. Existing client entries and credentials survive failures. |
| 2. Portable setup and runtime | Extract client adapters; add Claude Desktop and VS Code with explicit project/user scope and `--config` overrides. Deliberately migrate the minimum Node version and build toolchain in the major release. | Client-config fixtures on Windows/Linux/macOS, paths with spaces, backup/restore, collision handling, and successful stdio launches from a different working directory. CI covers the selected supported LTS versions. |
| 3. Prove useful API tasks | Package three curated integrations with pinned spec snapshots and ten representative tasks each: GitHub, Stripe test mode, and a local reference API. Compare raw endpoints, curated endpoints, and workflows under the same model and task budget. | Publish task completion, tool-selection errors, tool calls, token use, latency, model version, spec hash, and fixture provenance. CI uses deterministic local fixtures; live sandbox checks are explicit and separate. |
| 4. Release and adoption | Publish reproducible setup guides, a short end-to-end demo, and tested registry entries carrying the actual verification level and freshness. | Five external users attempt setup; at least four complete a first task without editing client JSON. Record failures and resolve release-blocking onboarding issues. |

Suggested scope is four to six focused development weeks, subject to the client/auth work discovered in phase 1. Complete and assess each phase before expanding the next one.

The dependency migration includes the deferred swagger-parser, commander, Vitest, tsup, TypeScript, and Anthropic SDK majors. Add mocked optimizer/docs-inference API contract tests before moving the Anthropic SDK to 1.x; replace or isolate the JavaScript compiler API before moving to TypeScript 7.

## First implementation PR

Build `mcpforge doctor --dir <generated-project> [--json]` around the existing verifier, without mutating client settings. Share the check orchestration with `test` and `connect` rather than creating another execution path.

- Return stable check identifiers, passed/failed/skipped states, actionable next commands, and a nonzero exit code for failed required checks.
- Separate read-only inspection from checks that install, build, start a process, or make network requests. State the chosen mode before running it.
- Never call a real upstream API by default. Credential presence is not proof of authentication; client JSON presence is not proof the client loaded its tools.
- Bind verification to both the final IR and the generated runtime/template version, so an old successful test cannot certify changed generated code.
- Cover missing dependencies, stale generated output, malformed config, missing credentials, and failed MCP startup through the packed CLI.

## Release gates

- Deterministic mock verification passes for every advertised supported fixture; unsupported cases are reported as skipped, with a reason.
- Connection/config changes remain idempotent and preserve unrelated entries. Failed verification leaves client registration unchanged.
- Secrets stay out of diagnostic JSON, example prompts, registry payloads, and logs.
- Local first-task setup target: median under five minutes on a documented clean machine, excluding account creation and credential issuance. Measure this with the external-user trials.
- Curated/workflow tools must improve task success or match it with lower tool/context cost on the published task set. A lower tool count alone does not satisfy this gate.
- Build, coverage, registry/release validation, production dependency audit, and packed-artifact verification pass on the declared support matrix.

## Boundaries for this milestone

Keep stdio/local operation as the initial execution model. Hosted multi-tenant servers, remote OAuth authorization servers, billing, a visual builder, arbitrary workflow code, and a broad marketplace require separate product decisions after the connection/task evidence exists. Browser-based provider OAuth can be evaluated per integration when the three-task-pack work exposes a concrete need.

Expose conservative MCP tool annotations and an enforceable read-only selection mode as part of task-pack hardening. Treat annotations as descriptive hints; enforce write restrictions in the selected/generated tool surface and runtime, and keep client approval behavior with the client.

## References

- [Cursor MCP configuration](https://cursor.com/docs/mcp)
- [Claude Desktop local MCP setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [MCP tools, structured results, and annotation trust](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

Client formats and protocol versions must be rechecked against their official documentation when each adapter is implemented.
