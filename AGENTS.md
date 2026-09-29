# Project rules

Two versions live here: the public site in `docs/` (GitHub Pages: a projects homepage, the Investing Tracker app in `docs/investing-tracker/` that also links to the GO Train planner, which lives in its own repo) and the original local Python app (`portfolio.py`, `static/`).

- Never commit real holdings, API keys or database files. The web app keeps them in the browser only; the Python app keeps SQLite outside the repo.
- Keep `docs/investing-tracker/calc.js` free of DOM code and covered by `tests/calc.test.js`. Add a test for every calculation change.
- Market data comes from Alpha Vantage's free plan (25 requests/day). Respect caching and the daily counter; never make a request per keystroke.
- No trading, brokerage logins or investment recommendations.
- Plain HTML/CSS/JS, no build step, so GitHub Pages can serve `docs/` directly.
- Describe the project honestly: Marcantonio decides what it does and reviews and tests each change; AI coding tools help write the code. Only list delivered features on the résumé.
