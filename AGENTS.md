# Project rules (Markets by MP)

Markets by MP is an investing platform plus the Markets API. One Cloudflare Worker serves the React app (`src/web`), accounts (`/api/auth`, Better Auth) and the API (`/api/v1`, `src/server`). Shared calculations live in `src/domain`. The earlier apps are in `legacy/`.

- **No trading, money movement or investment recommendations.** Plans are notes, not orders. Use "Your rule matched" and "Review this asset", never buy signals, confidence scores or rebound promises.
- **Never present demo data as real.** Every market-data response carries `meta.provenance`, and the UI labels demo data where it appears. Never substitute fictional data when a provider fails (return `502`). Never fill a real account with made-up holdings; demo data is seeded only for guest sessions.
- **Data rights.** Only a provider whose `rights.publicDisplay` and `rights.apiRedistribution` allow it may serve public responses. The Yahoo research adapter stays isolated and off. Track rights per use in `ProviderInfo`.
- **Money is decimal.** Use `src/domain/decimal.ts` (big.js) for authoritative numbers, transport decimals as strings, and use `null` (never `0`) for unknown values.
- **Every private query is scoped to the caller's user ID.** IDs from another account must return 404. Add an API test for any new private endpoint.
- **Tests.** Add a test in `tests/` for every calculation or API behaviour change. `npm test` and `npm run typecheck` must pass before committing.
- **Secrets** stay server-side (`wrangler secret put`; `.dev.vars` locally, never committed). No upstream provider keys in the browser.
- **Accessibility.** Gains and losses use signs and words, not colour alone. Charts have text summaries and keyboard reading. Touch targets are 44px on phones. Respect reduced motion.
- **CPU budget.** The free Workers plan limits CPU per request. Keep hot paths cheap (cache per isolate, no BigInt or Intl construction in loops) and measure with a quick benchmark before adding work to endpoints that touch every instrument.
- **Copy.** Plain and direct, with no em dashes. Describe the project honestly: Marcantonio decides what it does and reviews and tests each change; AI coding tools help write the code.
- **Publishing:** `npm run deploy` (see docs/DEPLOY.md). Pushing to GitHub doesn't deploy.
