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
| Community | **Demo-only** | Labelled sample discussions and bookmarks. Public posting stays closed until reporting, blocking and moderation run. |
| Read-only brokerage connections | **Blocked** | No aggregation provider. Wealthsimple/Questrade coverage not verified. No credentials ever collected. |
| Markets API: public keyless endpoints, private endpoints, OpenAPI, interactive docs, status, changelog, coverage, rate limits, CORS | Implemented | |
| Production market data | **Blocked** | No licensed provider. The Yahoo adapter is isolated, off, and has no public display or redistribution rights. |
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
