# Candidate evaluation results

Measured on 2026-10-30 UTC (2026-10-29 in the development timezone), Windows, Node 24.11.0, with `claude-sonnet-5-5`. Thirty synthetic tasks were each evaluated against three catalogs, for ninety model requests. Provider calls used local mock upstreams. Inputs were supplied explicitly to the model.

| Catalog | Successful selection and mock request | Selection errors | Input tokens | Output tokens | Tool calls | Median measured latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Raw excerpt | 30/30 | 0 | 111,558 | 3,525 | 30 | 1,965.5 ms |
| Reviewed subset | 30/30 | 0 | 92,888 | 3,525 | 30 | 1,786 ms |
| Generated workflow tools | 30/30 | 0 | 61,292 | 1,896 | 30 | 1,618 ms |

In this run, the reviewed subset used 16.7% fewer input tokens than raw excerpts. Workflow tools used 45.1% fewer. These are observed context costs for a small known task set, not general savings guarantees. Latency includes model/network variability and the mock invocation; it is not a controlled speed comparison.

The [complete model report](./results/model.json) records the implementation fingerprint, template identity, model, limits, per-case spec hashes, tokens, latency, and outcomes. The measured tool-selection implementation is in commit `3997084`; a subsequent fix makes receipt hashing locale independent without changing catalogs or prompts.

The [first diagnostic run](./results/model-before-workflow-fix.json) is also retained. Raw and reviewed subsets passed 30/30; workflows passed 27/30, with three GitHub selection failures. Investigation found that broad API tags collapsed nested commits, branches, and contributors into generic repository workflow names/descriptions. Naming now follows the actual resource path and retains operation descriptions. The subsequent full run above passed 30/30 workflows. The earlier report predates implementation-fingerprint instrumentation; both reports retain their actual model and spec hashes. This is one before/after observation, not repeated causal evidence.

The [deterministic contract report](./results/contract.json) separately verifies the expected tool without a model. Contract verification covers all advertised operations, including raw-catalog distractors, during setup; the ninety recorded cases are the thirty selected tasks across three variants.

These workflows are deterministic single-operation wrappers. This evaluation does not establish multi-step reasoning, answer quality, real provider authentication, client application loading, installation time, or external-user success. Curation used the known tasks. Held-out tasks, repeated runs, live sandbox checks, and the [five-person onboarding trial](../docs/ONBOARDING-TRIAL.md) remain necessary for broader claims.
