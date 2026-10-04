# Markets by MP

Your TSX and US stocks together, in Canadian dollars: live US prices, today's change, total return, allocation and a chart of your whole portfolio. It installs as an app on a phone or computer and keeps your keys and holdings in your own browser.

**Coming soon** at https://markets.marcantoniopovolo.com. The app works; I’m testing it before opening it up.

Built by [Marcantonio Povolo](https://marcantoniopovolo.com), a Computer Engineering student at Toronto Metropolitan University. I decide what it does and review and test each change; AI coding tools help write the code. It started as Portfolio Lab, then Investing Tracker.

## Data (all free)

| What | Source | Limit |
|---|---|---|
| US stock prices, live | [Finnhub](https://finnhub.io) (free key) | 60 requests a minute, no daily cap |
| Toronto (TSX) prices and price history | [Alpha Vantage](https://www.alphavantage.co) (free key, optional) | 25 requests a day, delayed |
| USD to CAD | [Frankfurter](https://frankfurter.dev) (no key) | Daily reference rate |

No free source offers real-time Toronto prices, so TSX prices are delayed. Visitors without keys see a demo portfolio with made-up holdings and sample prices.

## How it's built

Plain HTML, CSS and JavaScript with no build step. The app is in `app/` and isn’t published yet; Cloudflare serves `site/` (the coming-soon and project pages).

| Path | What it is |
|---|---|
| `app/index.html`, `app/style.css` | The app's page and styles (light and dark) |
| `app/app.js` | Screens, data fetching, caching, request limits, the setup guide |
| `app/calc.js` | Pure maths and data parsing with no browser code, so it can be tested in Node |
| `app/sw.js`, `app/manifest.webmanifest`, `app/icons/` | What makes it installable and work offline |
| `site/` | What Cloudflare serves at markets.marcantoniopovolo.com: the coming-soon page (`index.html`), the project page (`about/`), shared styles (`page.css`), icons and favicon. Built by `build_app_pages.py` in my portfolio folder. |
| `wrangler.jsonc` | Cloudflare Worker settings: serve `site/` at markets.marcantoniopovolo.com. Publish with `npx wrangler deploy`. |
| `tests/calc.test.js` | Tests for `calc.js`: run `node tests/calc.test.js` |
| `python-app/` | The original local version (Python and SQLite). Run with `cd python-app && python3 portfolio.py`; test with `python3 -m unittest -v` |
