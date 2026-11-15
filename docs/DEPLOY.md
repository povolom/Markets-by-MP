# Deploying Markets

Everything runs as one Cloudflare Worker (`markets-by-mp`) with static assets, a D1 database and a cron trigger. The custom domain `markets.marcantoniopovolo.com` is declared in `wrangler.jsonc` (`routes` with `custom_domain: true`); Cloudflare creates the DNS record and certificate on deploy.

## First time

```
npx wrangler login
npx wrangler d1 create markets-by-mp          # already done; the id is in wrangler.jsonc
npm run db:migrate:remote                       # applies migrations/*.sql to the remote database
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npm run deploy                                  # vite build, then wrangler deploy
```

`BETTER_AUTH_URL` and `ENVIRONMENT` are plain vars in `wrangler.jsonc`. Never commit `.dev.vars`.

Optional: a free CoinGecko Demo key raises the crypto rate limit (`npx wrangler secret put COINGECKO_API_KEY`). Without it Markets uses CoinGecko's keyless API with caching. Set `MARKET_DATA=offline` to use demo data for everything (tests do this).

To refresh the list of searchable listings: `node scripts/build-universe.mjs`, then commit `src/server/data/universe.gen.ts`.

## Every release

```
npm test && npm run typecheck
npm run db:migrate:remote      # only if migrations/ changed
npm run deploy
```

Pushing to GitHub doesn't deploy this Worker; run `npm run deploy`.

## Checks after deploying

- `GET /api/v1/status` returns `ok`.
- The landing page loads, "Explore the demo" opens a seeded workspace, and signup works.
- Cloudflare dashboard → Workers → markets-by-mp → Logs: no `1102` (CPU limit) errors. Observability is enabled in `wrangler.jsonc`.

## Backups and recovery

D1 keeps 30 days of point-in-time recovery (Time Travel). `npx wrangler d1 time-travel info markets-by-mp` shows restore points; `npx wrangler d1 export markets-by-mp --remote --output backup.sql` takes a full export.

## Configuration still to add

| What | How | Unlocks |
|---|---|---|
| Email provider | Add the provider's API key as a secret and set `EMAIL_PROVIDER` | Email verification, password reset, email alerts |
| Licensed market data | New adapter in `src/server/providers/`, rights set in its `ProviderInfo`, selected in `registry.ts` | Real prices for display and the API |
| Read-only account aggregation | Provider sandbox keys, hosted consent flow, webhook secret | Connections |
