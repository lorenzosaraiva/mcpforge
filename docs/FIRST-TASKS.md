# First tasks with the 2.0 candidate

Use Node 22.19+ and run `npm ci` followed by `npm run build` from the repository root. The commands below use this checkout's CLI. Replace `cursor` with `claude-desktop --scope user` or `vscode` as appropriate; see [client configuration](./MCPFORGE-2.md).

## GitHub reads

```sh
npm run dev -- connect ./benchmarks/packs/github/openapi.json --client cursor --read-only --name github-tasks
```

The pinned excerpt includes your authenticated profile, public users, repository metadata, issues, pull requests, commits, branches, and contributors. The full pack has three additional catalog distractors; the `github-tasks` registry entry contains the ten reviewed tasks.

Set the generated `ACCESS_TOKEN` variable to a GitHub token with only the permissions you need. The `/user` route requires authentication. Other selected public reads allow anonymous access; private repositories require suitable token permissions. See [GitHub's authentication guidance](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).

Enable or reload `github-tasks` in the client, then ask: “Use the GitHub tools to retrieve metadata for owner `github`, repository `rest-api-description`. Tell me its description and default branch.” This is a suggested live first task; the checked-in automated report uses synthetic inputs and a local mock upstream.

## Stripe sandbox reads

```sh
npm run dev -- connect ./benchmarks/packs/stripe-test/openapi.json --client cursor --read-only --name stripe-tasks
```

Create a Stripe sandbox and an appropriately restricted test key. The generated spec uses HTTP Basic authentication: put the test API key followed by a colon in `BASIC_AUTH`, for example `BASIC_AUTH='rk_test_REPLACE_ME:'`. Use the actual variable names in `.env.example`. See [Stripe's key documentation](https://docs.stripe.com/keys).

Reload the server, then ask: “Retrieve my Stripe sandbox balance. Show the available currencies and amounts.” The excerpt supports default unexpanded GET responses. It omits `expand`; it does not claim support for every expansion graph in the complete Stripe API.

## Diagnose and remove

Use the generated path shown by `connect`:

```sh
npm run dev -- doctor --dir ./mcp-server-github-task-pack --json
npm run dev -- doctor --dir ./mcp-server-github-task-pack --verify
npm run dev -- disconnect --name github-tasks --client cursor --yes
npm run dev -- disconnect --name stripe-tasks --client cursor --yes
```

Inspection reports credential presence, verification freshness, and managed registration without starting a process or making network requests. `--verify` executes mock checks. A real client call is still needed to establish provider authentication and application loading. Disconnect retains generated files and credentials; remove or archive those separately when appropriate.

## Local reference pack

`benchmarks/packs/reference` is a synthetic commerce contract containing reads and writes. It is intended for the local benchmark harness, which supplies its mock upstream and fixtures. Its example URL does not provide a hosted service. Run `npm run benchmark:contracts -- --pack reference --max-cases 30` to exercise it. This pack makes request serialization regressions reproducible without provider accounts.

## Registry receipts

The `github-tasks`, `stripe-test-tasks`, and `reference-tasks` entries in this repository are exported only after successful shared mock verification by `npm run benchmark:contracts -- --write-registry`. They contain the actual verification time, IR hash, runtime hash, generator version, counts, and source provenance. These are candidate catalog snapshots; availability in the CLI's separate default remote registry requires catalog publication. Use the local specification commands above now. A receipt reports on that generated artifact. Installation generates a new local artifact that must be verified again before connecting or publishing.
