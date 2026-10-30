# MCPForge task evaluations

Three pinned task packs contain ten tasks each: GitHub, Stripe test-mode use, and a hand-authored reference commerce API. Provider requests always go to local mock upstreams during these evaluations. `pack.json` records immutable upstream commits, SHA-256 hashes, transformations, and license links. `scripts/refresh-task-packs.mjs` reproduces the checked-in excerpts from the pinned official sources.

The Stripe pack explicitly targets default, unexpanded GET responses: fields annotated by Stripe as expandable are restricted to their string-ID branches, and `expand` query parameters are omitted. Expanded response graphs are outside this pack. This keeps the curated contract useful and avoids forcing every client validator to compile Stripe's entire transitive expansion graph. Do not interpret these results as support for all Stripe expansion combinations.

```sh
npm run build
npm run benchmark:contracts

# Sends synthetic prompts/tool schemas to Anthropic using your configured API key.
npm run benchmark:model -- --model claude-sonnet-5-5 --max-input-tokens 1000000 --max-output-tokens 100000
```

Contract mode uses an explicit oracle to invoke the expected generated tool, validate request construction and schemas, and record actual invocation latency. It does not use a language model. Model mode gives the same model and supplied operation inputs to three catalogs: the raw endpoint excerpt, a reviewed task-relevant subset, and generated workflow tools. It measures one-step tool selection and mock request correctness, token usage, latency, catalog size, and selection failures. It does not demonstrate end-to-end reasoning, real provider authentication, full multi-step user task completion, or behavior on the provider's full API catalog.

GitHub's upstream snapshot omits authentication declarations. The reproducible transformation adds bearer authentication required for `/user` and optional on the other public reads, following [GitHub's documentation](https://docs.github.com/en/rest/users/users#get-the-authenticated-user). Source and transformed hashes are both recorded. Provider snapshots retain their checked-in license notices.

`npm run benchmark:contracts -- --write-registry` additionally exports the three curated catalogs with actual shared-verifier receipts to the repository registry. It does not publish npm packages or call provider services. See [first-task setup and receipt semantics](../docs/FIRST-TASKS.md).

Reports live in `results/contract.json` and `results/model.json`. Every case includes its spec hash; current reports fingerprint the implementation and generator templates. Model reports include the explicit model, limits, actual token counts, and failure categories. No credentials or conversation transcripts are recorded. A rejected credential, exhausted account, or rate limit halts evaluation rather than repeating paid failures. The script exits nonzero for incomplete or failed runs and still preserves the partial report. Generated registry entry snapshots are compact JSON to avoid duplicating large schema trees; their index and source packs remain readable.

The default limits cover 90 cases (30 tasks × 3 variants), at most 1,000,000 input tokens and 100,000 output tokens, with at most 2,048 output tokens per request. A conservative context estimate reserves room before each model call. Limits are safeguards on a measured experiment, not a pricing guarantee. Check [current model pricing](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) before rerunning.

Fixtures are deliberately small and the reviewed curation uses the known task set. Treat this as an initial regression/evaluation suite, not a general benchmark claim. Expand held-out tasks and run repeated trials before drawing broad conclusions. All-skipped verification is a failure; unsupported cases must remain explicit.

The separate [external onboarding trial](../docs/ONBOARDING-TRIAL.md) is still required for claims about installation time and first-task user success.
