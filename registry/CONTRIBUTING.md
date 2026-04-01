# Registry Contributions

Open a focused PR against `main` with:

- `registry.json` updated to include or update your entry metadata
- `entries/<slug>.json` added or updated with the full registry payload
- A unique, stable `slug`
- Real tags, a meaningful description, and a non-localhost base URL

Review policy for the public registry:

- `main` should be branch-protected
- Require 1 approving review before merge
- Publish changes through a PR when you are not the repo owner

Before opening the PR, validate that your generated project still contains `mcpforge.config.json`, a non-empty `selectedTools` array, and the final IR you want others to install.
