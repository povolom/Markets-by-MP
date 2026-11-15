# Feature inventory (beta 1, November 2026)

**Implemented** works end to end with persistent storage and tests. **Demo-only** works but with labelled demo data or examples. **Blocked** needs credentials, data rights or a provider that isn't connected; the product says so where it appears.

| Area | Status | Notes |
|---|---|---|
| Public landing, demo entry without signup | Implemented | Guest (anonymous) session with a labelled demo workspace |
| Signup, login, logout, persistent sessions | Implemented | Better Auth, 30-day sessions, passwords ≥10 characters |
| Email verification, password reset by email | **Blocked** | No email provider configured. Reset page explains this. |
| Guest → real account | Implemented | Watchlists, rules, plans and journal move across; the demo portfolio does not |
| Onboarding (name, base currency, interests) | Implemented | Short and skippable |
| Profile, theme, data export, account deletion | Implemented | Export is full JSON; deletion cascades through every table |
| Watchlists: multiple, create/rename/reorder/delete, add/remove, sort/filter, sparklines | Implemented | Cross-device via the API |
| Search by company name, ticker or nickname | Implemented | Ranked matching with aliases ("google", "coca cola", "royal bank") and typo tolerance across about 12,000 instruments (every US-listed stock and ETF, major TSX listings, top 250 crypto, 12 currency pairs). The same search and picker are used for watchlists, dip rules, plans, transactions and the global search |
| Asset pages: quote, session, chart ranges, raw vs total-return, statistics by asset class, financials, dividends, events, news, related, discussions | Implemented on **demo data** | Indexes marked not purchasable; crypto has no valuation metrics |
| News | **Demo-only** | Demo headlines, labelled, never used to explain moves. Real news needs a licensed provider. |
| Portfolio: multiple portfolios, manual transactions, CAD/USD, trade-date FX, dividends, fees, splits, contributions vs gains, missing cost basis | Implemented | Prices are demo data |
| CSV import: mapping, validation, preview, duplicates, reversible batches | Implemented | |
| Performance: TWR, XIRR, benchmark on same dates, volatility, drawdown | Implemented | On demo prices |
| Income: received and upcoming (declared vs projected) | Implemented | |
| Portfolio X-Ray: look-through, overlap, sector/country/currency, concentration | Implemented on **demo fund compositions** | Coverage and dates shown |
| Dip Radar: rules, crossing/reset/cooldown/dedupe, sources and exposure, sorting | Implemented | Cron every 30 min plus "Check my rules now" |
| Dip Context: benchmark and peers, volatility, drawdown, events, news, exposure | Implemented on demo data | No causal claims |
| Buy Plans: regular / dip / hybrid, levels, limits, no double-counted cash | Implemented | Plans are never orders |
| What-If | Implemented | Never writes to the database |
| Similar & Different | Implemented | Reasons and disclaimer on every suggestion |
| Calendar (events + plan/journal reviews), Market Brief | Implemented | Estimated dates labelled |
| Notifications | Implemented in-app | **Push and email notifications blocked** (no push/email service configured) |
| Investment Journal | Implemented | Links to assets, plans and transactions |
| Community: shared portfolios | Implemented | Members can share a portfolio under a handle. Others see allocation percentages and top holdings only, never amounts, cash values or transactions. Follow portfolios to keep them in a Following tab. Five labelled sample portfolios ship with the beta |
| Community: discussions | **Demo-only** | Labelled sample discussions and bookmarks. Public posting stays closed until reporting, blocking and moderation run |
| Read-only brokerage connections | **Blocked** | No aggregation provider. Wealthsimple/Questrade coverage not verified. No credentials ever collected. |
| Markets API: public keyless endpoints, private endpoints, OpenAPI, interactive docs, status, changelog, coverage, rate limits, CORS | Implemented | |
| Crypto prices and history | Implemented | Real, from CoinGecko (keyless or a free Demo key), credited in the app. Not redistributed through the public API (`403 not_licensed`). History covers the last 365 days |
| Exchange rates | Implemented | Real European Central Bank reference rates via Frankfurter, used for FX quotes and portfolio currency conversion |
| Your own data key (Questrade) | Implemented, needs a real-account test | Questrade customers connect a personal API app token: TSX, TSX Venture and US prices and history with no daily cap. Markets stores the rotating refresh token encrypted, refreshes it on use and once a day |
| Your own data key (Alpha Vantage) | Implemented | Free key, about 25 calls a day: TSX, TSX Venture and US daily closes and history. One call per stock per day, cached at the edge per user; never used by scheduled checks |
| Desktop app (Mac and Windows) | Implemented | Tauri app (~8 MB) with the Markets API embedded; local SQLite; Yahoo Finance (personal use, no key) for stocks, ETFs and indexes worldwide, CoinGecko, ECB; dip alerts as notifications every 30 minutes while open. Unsigned builds from GitHub Actions |
| Smart routing | Implemented | Each asset uses the best connected key: Canada via Questrade, then EODHD, then Alpha Vantage; US via Alpaca, then Questrade, then EODHD, then Alpha Vantage; indexes via EODHD. Scheduled dip checks skip closed markets to save calls |
| Cross-listings | Implemented | 55 TSX companies link to their New York listing (e.g. CNR and CNI) |
| Your own data key (EODHD) | Implemented | One key covers US and Canadian stocks and ETFs (NYSE, Nasdaq, TSX, TSX Venture) and the S&P 500, Nasdaq, Dow and TSX indexes: delayed intraday quotes, daily history and real dividends, for that user only. Free EODHD plans (20 calls a day) skip scheduled dip checks to save calls |
| Your own data key (Alpaca, US only) | Implemented | A signed-in user connects their own free Alpaca key in Settings. Markets encrypts it (AES-GCM) and uses it only for that user: real US stock and ETF prices (IEX real-time), daily history, charts and intraday Dip Radar alerts. Never shared, never sent back to the browser |
| Public stats | Implemented | `GET /api/v1/stats`: desktop downloads from GitHub Releases (by platform) and API calls served (counted per day, batched writes, no IPs or paths stored). Shown on the start page and Developers page |
| Showcase demo | Implemented | Visitors and demo guests see labelled demo prices for every listing; Exit demo returns to the start page |
| Locked prices | Implemented | For signed-in web accounts without a key: listings outside the curated list show a blurred, locked price with the next step (create an account, connect a key) instead of a made-up number. Non-curated Canadian listings say no free source exists yet |
| Stock, ETF, fund and index prices | **Demo-only** | Generated and labelled. Free stock feeds (Finnhub, Twelve Data, Alpha Vantage, FMP) are personal-use only; a licensed feed is needed for public display. The Yahoo adapter stays isolated and off |
| Strategy Lab | Not started (later stage) | |
| Native iOS/Android/desktop apps | Not started | The PWA installs on supported browsers; it is not a native app. |
| Trading, transfers, money movement | Out of scope | Never in the beta |

## Validation (2026-11-15)

- `npm test`: 42 passing. Covers portfolio accounting (contributions, dividends, fees, splits, FX, missing cost basis), TWR/XIRR/drawdown, Dip Radar boundaries/reset/cooldown/dedupe/split safety, plan allocation, CSV parsing/validation/duplicates, market sessions by timezone, X-Ray look-through/overlap, What-If isolation, API schema and provenance, pagination, bounded ranges, cross-user isolation, guest-only demo seeding, import/undo, cross-origin write blocking, export/deletion, and rate limiting (429 with retry).
- `npm run typecheck`: clean.
- Browser walkthrough of demo → overview → watchlist → asset → dip rule → What-If → saved plan at desktop and phone widths, with no console errors.

## Known limits

- Exchange holidays aren't modelled (weekends are).
- Cloudflare's free plan limits CPU time per request. Demo data is generated on first use in each server instance (about 1 ms per instrument) and then cached. If heavy endpoints hit the limit, they'll need optimizing further or the paid Workers plan.
