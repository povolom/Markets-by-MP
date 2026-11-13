# Markets by MP

Your TSX and US stocks together, in Canadian dollars: live US prices, today's change, total return, allocation and a chart of your whole portfolio. It installs as an app on a phone or computer and keeps your keys and holdings in your own browser.

**Status:** coming soon at https://markets.marcantoniopovolo.com · [About the project](https://marcantoniopovolo.com/projects/markets.html) · Open source (MIT)

The app works; I'm testing it before opening it up. It started as Portfolio Lab, then Investing Tracker.

Built by [Marcantonio Povolo](https://marcantoniopovolo.com), a Computer Engineering student at Toronto Metropolitan University. I decide what it does and review and test each change; AI coding tools help write the code.

## Data (all free)

| What | Source | Limit |
|---|---|---|
| US stock prices, live | [Finnhub](https://finnhub.io) (free key) | 60 requests a minute, no daily cap |
| Toronto (TSX) prices and price history | [Alpha Vantage](https://www.alphavantage.co) (free key, optional) | 25 requests a day, delayed |
| USD to CAD | [Frankfurter](https://frankfurter.dev) (no key) | Daily reference rate |

No free source offers real-time Toronto prices, so TSX prices are delayed. Without keys, the app shows a demo portfolio with made-up holdings and sample prices.

## Try it locally

```
cd app
python3 -m http.server
```

Then open http://localhost:8000. Tests: `node tests/calc.test.js`.

## Layout

| Path | What it is |
|---|---|
| `app/index.html`, `app/style.css` | The app's page and styles (light and dark) |
| `app/app.js` | Screens, data fetching, caching, request limits, the setup guide |
| `app/calc.js` | Pure maths and data parsing with no browser code, so it can be tested in Node |
| `app/sw.js`, `app/manifest.webmanifest`, `app/icons/` | What makes it installable and work offline |
| `tests/calc.test.js` | Tests for `calc.js` |
| `python-app/` | The original local version (Python and SQLite). Run with `cd python-app && python3 portfolio.py`; test with `python3 -m unittest -v` |
| `site/` | The website at markets.marcantoniopovolo.com: the coming-soon page (`index.html`, `style.css`), icons and favicons. `about/` and `_redirects` send the old project page to [marcantoniopovolo.com/projects/markets.html](https://marcantoniopovolo.com/projects/markets.html) |
| `worker.js` | The API: anything under `/api/` (for now `/api/status`). Everything else is served from `site/` |
| `wrangler.jsonc` | Cloudflare settings: `site/` plus `worker.js` at markets.marcantoniopovolo.com |
| `LICENSE` | MIT: free to use, change and share |
| `AGENTS.md` | Rules for AI coding tools working in this repo |

The app in `app/` isn't online yet; only `site/` is published.

## Publishing

Pushing to GitHub saves the code. To put `site/` online at markets.marcantoniopovolo.com, run this in the repo folder:

```
npx wrangler deploy
```

## API

The app and its API share one address. The website is served from `site/`; requests under `/api/` go to `worker.js`. While the app is coming soon there is one endpoint:

```
curl https://markets.marcantoniopovolo.com/api/status
```

## Open source

This project is open source under the [MIT License](LICENSE). Fork it, change it and make your own version; just keep the license notice. Issues and pull requests are welcome.
