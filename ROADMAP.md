# MCPForge roadmap

Updated: 2026-10-29. Current milestone: **MCPForge 2.0 release candidate — verified API connections**.

## Product outcome

Give MCPForge an OpenAPI spec, choose a client, and get useful tools running with clear evidence of what passed, which credentials are needed, and how to repair a failed connection.

```sh
mcpforge connect ./openapi.yaml --client cursor --read-only
mcpforge doctor --dir ./mcp-server-example --json
mcpforge disconnect --name mcpforge-example --client cursor --yes
```

These commands are implemented in the candidate. Use the [source-checkout instructions and migration guide](./docs/MCPFORGE-2.md) until npm publication. Mock verification does not establish that provider credentials work or that a client loaded its tools.

## Delivery status

| Phase | Delivered in the candidate | Remaining evidence |
| --- | --- | --- |
| Connection lifecycle | Shared verifier; read-only `doctor` inspection and explicit `--verify`; stable JSON checks; non-secret connection records; safe repair and disconnect; private backups and concurrent-edit detection. | External application loading and onboarding trials. |
| Portable setup and runtime | Cursor, Claude Desktop, and VS Code adapters; project/user scope and explicit paths; JSONC preservation; Node 22.19+; TypeScript 7, Vitest 5, tsup 9, Swagger Parser 13, Commander 15, Anthropic SDK 1. | CI is the authority for the declared OS/Node matrix. Recheck official client formats as they evolve. |
| API task evidence | Three pinned packs, ten tasks each; raw, curated, and workflow catalogs; deterministic contract oracle plus bounded model evaluation; schema graph/reference fixes; enforced read-only mode and MCP annotations. | The published evaluation measures one-step tool selection and mock requests. Held-out tasks, repeated runs, live sandbox authentication, and multi-step completion are separate work. |
| Release and adoption | Reproducible setup/migration/evaluation guides and a five-user trial protocol. Runtime-bound registry receipts distinguish mock/live verification and legacy reports. | Execute external trials; publish a short application demo; approve stable release based on measured results. |

See [evaluation scope, provenance, and reports](./benchmarks/README.md) and the [onboarding trial protocol](./docs/ONBOARDING-TRIAL.md). Automated tests cannot substitute for the external-user gate.

## Stable 2.0 gates

- Build, tests, coverage, registry/release validation, production dependency audit, packed-artifact checks, and local task contracts pass on the declared support matrix.
- Reconnect/repair/disconnect preserve unrelated settings and credentials. Failed verification does not register a server. Changed generated code or templates invalidates previous verification.
- Diagnostics and connection/registry metadata contain no credential values. Unsupported checks remain explicit; all-skipped verification fails.
- Five external users attempt setup, and at least four finish a first task without editing client JSON. Measure a median setup time under five minutes, excluding accounts and credential issuance. Record and resolve blocking failures.
- Curated/workflow tools match or improve task success with lower context cost on published tasks. Keep the current one-step evaluation separate from claims about full task completion.
- A real-client demo shows connect, credential setup, first task, doctor, and disconnect. Publish npm only after the release evidence is reviewed.

The candidate leaves these human and live-service gates visible. It does not claim a stable release solely because implementation is complete.

## Next investment after the candidate

1. Run the onboarding trial against current Cursor, Claude Desktop, and VS Code. Turn each observed failure into a reproducible regression before expanding scope.
2. Add held-out tasks and genuine multi-step workflows: discover an issue then read its discussion; find a customer then inspect invoices; diagnose an order then summarize fulfillment. Measure final answers and intermediate requests, not just tool selection.
3. Add explicit live sandbox checks for GitHub and Stripe test mode. Record credential validity and provider responses separately from deterministic mock contracts. Never run these implicitly in ordinary CI.
4. Publish small tested registry integrations with source pins, actual receipt levels, and clear re-verification behavior after installation. Expand the catalog only as task evidence grows.
5. Evaluate browser OAuth per integration where trials show manual token setup blocks adoption. Local stdio remains the baseline.

Hosted multi-tenant servers, a remote authorization service, billing, a visual builder, arbitrary workflow code, and a broad marketplace require separate product decisions after this evidence exists.

## References

- [Cursor MCP configuration](https://cursor.com/docs/mcp)
- [Claude Desktop local setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [MCP tools and annotation trust](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)