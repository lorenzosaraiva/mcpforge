# OPTIMIZER RESULTS

## Historical Standard Mode (previous baseline)

| API | Raw Endpoints | Standard Mode |
|-----|--------------:|--------------:|
| GitHub | 1,079 | 108 |
| Stripe | 587 | 100 |
| Spotify | 97 | 60 |

## Strict Mode Re-run (2026-03-02)

| API | Raw Endpoints | Standard Mode | Strict Mode | Reduction vs Raw |
|-----|--------------:|--------------:|------------:|-----------------:|
| GitHub | 1,079 | 108 | 25 | 97.68% |
| Stripe | 587 | 100 | 25 | 95.74% |
| Spotify | 97 | 60 | 25 | 74.23% |

## Run Notes

- Commands run:
  - `MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init --dry-run --optimize /tmp/github-openapi.json`
  - `MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init --dry-run --optimize /tmp/stripe-openapi.json`
  - `MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init --dry-run --optimize /tmp/spotify-openapi.yml`
- All strict benchmark runs completed successfully.
- Full strict tool lists are captured in:
  - `examples/optimizer-report-github.md`
  - `examples/optimizer-report-stripe.md`
  - `examples/optimizer-report-spotify.md`
  - `examples/strict-benchmark-results.json`

## Observations

- Strict mode now consistently enforces a 25-tool output cap across small, medium, and very large APIs.
- This materially improves MCP tool discoverability for LLM clients versus standard mode output volume.
