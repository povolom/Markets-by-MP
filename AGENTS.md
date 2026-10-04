# Project rules

Markets by MP. The web app is in `app/` (not published yet; Cloudflare serves `site/` at markets.marcantoniopovolo.com); the original local Python app is in `python-app/`.

- Never commit real holdings, API keys or database files. The web app keeps them in the browser only; the Python app keeps SQLite outside the repo.
- Keep `app/calc.js` free of DOM code and covered by `tests/calc.test.js`. Add a test for every calculation change.
- Market data: Finnhub free (US, live, 60 requests a minute), Alpha Vantage free (TSX and history, 25 a day), Frankfurter (USD/CAD, no key). Respect caching and the limits; never make a paid-plan request. Keys stay in the browser.
- No trading, brokerage logins or investment recommendations.
- Plain HTML/CSS/JS, no build step, so the files can be served as they are.
- Describe the project honestly: Marcantonio decides what it does and reviews and tests each change; AI coding tools help write the code. Only list delivered features on the résumé.
