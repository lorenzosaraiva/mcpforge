# OPTIMIZER RESULTS

| API | Raw Endpoints | Unoptimized Tools | Optimized Tools | Reduction % |
|-----|--------------:|------------------:|----------------:|------------:|
| GitHub | 1079 | 1079 | 108 | 89.99% |
| Stripe | 587 | 587 | 100 | 82.96% |
| Spotify | 97 | 97 | 60 | 38.14% |

## Overall Observations
- The optimizer substantially improves naming and descriptions, especially for endpoint-heavy APIs.
- For very large APIs, context/rate limits dominate behavior; scoped optimization and chunking are necessary.
- Results are best when optimizing a prioritized subset rather than the full raw endpoint set in one pass.

## What It Does Well
- Converts operationId-style names into clearer assistant-friendly verbs.
- Rewrites descriptions to specify actions and expected returns.
- Removes obvious noise endpoints (meta/health/spec/admin-like operations) in many cases.

## What Needs Improvement
- Full-spec optimization is still unreliable for massive APIs without manual caps.
- Category decisions can over-prune niche but potentially useful endpoints.
- Duplicate/near-duplicate operations can survive if spread across chunks.

## Concrete Prompt Improvements
- Add stricter per-tool output budget: max 8 parameters unless explicitly justified.
- Add explicit coverage-mode instruction: preserve at least one tool per high-value tag.
- Add chunk-level reconciliation prompt: merge near-duplicates across chunk outputs before final IR.
- Add explicit deprecation handling instruction: keep deprecated routes only if no modern equivalent exists.
- Add deterministic naming rule section (resource + action) to reduce naming drift across chunks.

## Notes
- Stripe optimized result came from workaround mode (maxEndpointsForOptimization=100) after a direct run hit Anthropic TPM rate limits.
- GitHub optimized result used built-in large-API cap (maxEndpointsForOptimization=200), so optimized list is a curated subset.
