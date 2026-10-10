# Prime Agent for Devin (`pi`)

The base is ahuserious/prime-agent 6f413ac9e (TypeScript extension host). Current upstream main is Rust-only and incompatible with these extensions. Original Prime butterfly branding is retained unchanged.

`pi-local` starts the compiled bundle. Configure `PRIME_AGENT_CODING_AGENT_DIR` to a private directory containing auth.json, settings.json, and models.json. Default is the lane's adjacent agent directory. The VM launcher uses `/srv/pi/config`. Never commit those auth files.

All four Titan extensions load only with `--titan`. The default session registers no Titan commands, footer, DAG UI, or workflow hooks. To use the typed-DAG harness: `pi --titan`, then its `/titan` and workflow commands. Existing Titan capabilities are preserved in the pinned vendor snapshot.

Always-loaded extensions: Antigravity and Braintrust (the latter activates only with BRAINTRUST_API_KEY). Grok and OpenAI OAuth are built into the host. Google, Cerebras, and OpenRouter API-key support is built in. `models.example.json` pins live-tested model identifiers and the Cerebras User-Agent workaround. Gemini 3.7 Flash requires low or higher reasoning; the config disables unsupported off/minimal choices.

Braintrust SDK is pinned to 3.36.0, published 2026-10-01 (over 7 days old). Traces contain model/provider, token counts, and cost only; prompts, tool arguments, and outputs are omitted. The SDK also provides `Eval` for separately authored evals; no live-provider CI evals were added. Integration uses the official [SDK API](https://www.braintrust.dev/docs/reference/libs/nodejs).

Vendor provenance:
* `vendor/antigravity`: pi-antigravity 0.7.2, published 2026-09-05, Rahularya01/pi-antigravity, license included. Only local change: import `registerApiProvider` from the pi-ai root export instead of `/compat`, which the selected Prime host lacks.
* `vendor/titan-harness`: ahuserious/titan-harness 43909cb5eb1d19d32a57ef83e45b191c7b90fbc6, package 0.9.2. Copied committed tree, not local uncommitted files.

Build: `npm ci --ignore-scripts`, run `node_modules/.bin/tsgo -p packages/{tui,ai,agent,coding-agent}/tsconfig.build.json` in that order, then `npm run copy-assets --workspace=packages/coding-agent` and `npm run bundle --workspace=packages/coding-agent`. Checks: `npm run check` and `npm run check:test-policy`. No dependency was resolved younger than seven days; root lockfile is the selected fork's committed 2026-09-23 lockfile.
