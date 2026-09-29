# Project rules

Two versions live here: the public site in `docs/` (GitHub Pages: a projects homepage, the Portfolio Lab app in `docs/portfolio-lab/`, and a GO Train planner page in `docs/go-train/`) and the original local Python app (`portfolio.py`, `static/`).

- Never commit real holdings, API keys or database files. The web app keeps them in the browser only; the Python app keeps SQLite outside the repo.
- Keep `docs/portfolio-lab/calc.js` free of DOM code and covered by `tests/calc.test.js`. Add a test for every calculation change.
- Market data comes from Alpha Vantage's free plan (25 requests/day). Respect caching and the daily counter; never make a request per keystroke.
- No trading, brokerage logins or investment recommendations.
- Plain HTML/CSS/JS, no build step, so GitHub Pages can serve `docs/` directly.
- Describe the project honestly as AI-assisted. Only list delivered features on the résumé.
