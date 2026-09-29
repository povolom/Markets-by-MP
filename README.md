# Investing Tracker

Track TSX and US holdings in Canadian dollars with live (delayed) quotes, daily price charts, day change, unrealized gain/loss and allocation.

**Live app:** https://povolom.github.io/Investing-Portfolio-Project/investing-tracker/

The site root, https://povolom.github.io/Investing-Portfolio-Project/, is a small projects homepage that also lists my upcoming projects, a [GO Train commute planner](https://github.com/povolom/GO-Train-Planner) and a [photography gallery](https://github.com/povolom/Photography-Gallery), which live in their own repos.

Built by [Marcantonio Povolo](https://marcantoniopovolo.com), a Computer Engineering student at Toronto Metropolitan University, as a learning project. I decide what it does and review and test each change; AI coding tools help write the code.

## Features

- **Portfolio in CAD.** TSX holdings (`SHOP.TRT`) are priced in CAD; US holdings (`AAPL`) convert at the live USD/CAD rate.
- **Live quotes** from Alpha Vantage: price, day change, previous close and day range.
- **Price history chart** for each holding (last 100 trading days) with your average cost marked.
- **Allocation donut**, per-position weight, and unrealized gain/loss in dollars and percent.
- **Market watch** strip for up to 6 symbols (default XIU.TRT, SPY, QQQ).
- **Symbol search** that suggests TSX and US listings as you type.
- **Private by design.** No accounts or server. Your API key and holdings are saved only in your own browser (localStorage). Export and import JSON to move them between devices.
- **Demo mode.** Visitors without a key see fictional sample holdings with sample prices.

## Use it

1. Open the live app.
2. Get a free API key at https://www.alphavantage.co/support/#api-key.
3. Click **Connect live data**, paste the key and save.
4. Add holdings: symbol, shares, average cost and the currency you paid in.

The free plan allows 25 requests a day and quotes are delayed, so the app caches quotes for 30 minutes, the exchange rate for 6 hours and charts for 12 hours, and shows how many requests you've used today.

## How it's built

| Path | What it is |
|---|---|
| `docs/index.html`, `docs/hub.css` | Projects homepage (served by GitHub Pages from `/docs`). |
| `docs/investing-tracker/index.html`, `docs/investing-tracker/style.css` | The Investing Tracker web app. Add `?embed=1` to hide the back link when it is shown inside another site. |
| `docs/investing-tracker/calc.js` | Pure portfolio maths and API response parsing, with no browser code, so it can be tested in Node. |
| `docs/investing-tracker/app.js` | UI, data fetching, caching and rate-limit handling. |
| `tests/calc.test.js` | Calculation tests: `node tests/calc.test.js` |
| `python-app/` | The original local version (Python standard library + SQLite) that Investing Tracker grew out of. Run with `cd python-app && python3 portfolio.py`; test with `python3 -m unittest -v`. |

## Maths

- Cost = shares × average cost, converted to CAD at the current USD/CAD rate when bought in USD.
- Value = shares × latest price, converted to CAD for US listings.
- Unrealized gain = value − cost. Weight = position value ÷ portfolio value.
- Day change = shares × (price − previous close).

Not included: fees, dividends, cash, taxes, realized gains, or historical FX rates for your purchases. This is a learning project and not investment advice.

## Publish on GitHub Pages

Repository **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/docs`. GitHub Pages on a free account requires the repository to be public. Personal holdings are never stored in the repository.
