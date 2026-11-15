# Calculation methodology

Every authoritative number comes from deterministic code in `src/domain/` with tests in `tests/domain.test.ts`. The app and the API use the same functions, so they always agree. Values cross the API as decimal strings; unknown values are `null`, never `0`.

## Portfolio accounting (`portfolio.ts`)

- **Average-cost method** (as used for Canadian adjusted cost base). A buy adds its cost plus fees to the cost basis. A sale removes `average cost × units sold`; the difference from net proceeds is the realized gain.
- **Currency.** Each transaction stores the FX rate to the portfolio's base currency on its trade date (looked up when it's recorded or imported). Cost basis uses that historical rate; current market value uses today's rate. A currency move with an unchanged price is shown as a gain or loss, as it should be.
- **Splits** multiply the units and leave the cost basis unchanged, so a split is never a gain.
- **Contributions vs. gains.** Deposits and withdrawals are contributions. **Investment gain = total value − net contributions**, shown only when contributions were recorded and cash is knowable. Without recorded deposits, Markets shows unrealized and realized gains but doesn't claim an overall investment gain.
- **Missing cost basis.** A buy with no price makes that holding's cost basis, its gains and the cash balance unknown, with a warning explaining why. Nothing is guessed.
- **Dividends, interest and fees** are tracked as income and costs; dividends add to cash.

## Performance (`stats.ts`, `server/portfolio-service.ts`)

- A daily valuation series is rebuilt from the transactions and historical closes (and FX) on each date. It is never inferred from today's holdings.
- **Time-weighted return (TWR):** daily sub-period returns `(V_end − flow) / V_start`, linked geometrically. Flows are assumed to arrive at the end of the day.
- **External flows:** recorded deposits and withdrawals when there are any (cash is part of the portfolio). Otherwise the portfolio is measured as its holdings, with each purchase as money in and each sale as money out.
- **Money-weighted return (XIRR, annualized):** only shown with at least two dated cash flows of opposite sign spanning 30+ days.
- **Benchmarks** use adjusted closes (total return), converted to the base currency at each day's rate, over exactly the portfolio's dates.
- Volatility is annualized from daily returns (252 trading days; 365 for crypto). Maximum drawdown is the worst peak-to-trough fall.

## Dip Radar (`dips.ts`)

- **Rolling high:** the highest **adjusted close** (or, if chosen, the highest intraday high scaled by the same adjustment factor) in the last *N* calendar days including today. It is put back on today's price basis before comparing with the live price, so splits and distributions never look like dips.
- **Rules:** below rolling high, below 52-week high, at or below a target price, below my average cost (holdings), daily drop, weekly drop (5 trading days).
- **Boundary:** a rule matches when the drop is **at or below** −threshold (exactly 10% below matches a 10% rule).
- **Crossing and reset:** an alert fires only when an *armed* rule matches. It then disarms, and re-arms once the price recovers by the reset band (default 2 percentage points) past the threshold.
- **Cooldown:** a rule/instrument pair can't fire again within its cooldown (default 24 hours).
- **De-duplication:** at most one alert per rule, instrument and market date (database-enforced unique key).
- The daily change is always shown separately from the drop. Results can be sorted by any criterion; none is labelled "best". Language is "Your rule matched", never a buy signal.

## Buy Plans (`plans.ts`)

- A plan's **reserve** is its personal limit if set, otherwise one month of regular amounts plus all dip levels.
- `allocateCash` gives each active plan (in order) at most its reserve from the linked portfolio's cash, so **no dollar is counted twice**, and reports any shortfall. If cash is unknown, it says so.
- Levels reached use the same 30-day-high drop as Dip Radar. Amounts never grow when prices fall. Plans are not orders.

## What-If (`whatif.ts`)

- It applies one hypothetical buy, sell or contribution to a copy of the holdings. It distinguishes **spending existing cash** from **adding new money**, states the assumed price, FX rate and fee, and warns if a purchase exceeds cash.
- It reports weights, average cost, cash, sector, country and currency exposure, largest company exposure, a concentration index and trailing-yield dividend estimates. It never writes to the database.

## Portfolio X-Ray (`exposure.ts`)

- **Direct exposure** is each holding's share of total value including cash.
- **Look-through exposure** splits funds into their published holdings, with the composition's date and coverage. The undescribed remainder is reported as **"Not covered by holdings data"**, never as zero.
- Direct and indirect exposure to the same company are combined. Funds inside funds aren't expanded again, so nothing is double-counted.
- **ETF overlap** = sum over companies both funds describe of the smaller weight.
- **Concentration index** = Herfindahl index of known company exposures (0 to 10,000).

## Similar & Different (`similar.ts`)

Scores combine asset class, sector and industry, country, currency, the user's explicit interests, and the correlation of daily returns over the last year. Each suggestion lists its reasons. Similarity is not suitability, and a different ticker is not proof of diversification.

## CSV import (`csv.ts`)

Parse (quoted fields, BOM), map columns (auto-guessed, user-editable), validate every row (dates, types, numbers, coverage, no future dates), and preview before saving. Duplicates are detected by a normalized hash of date, type, instrument, quantity, price, amount and currency. Repeated identical rows within one file are kept as separate trades; rows already in the portfolio are skipped. Each commit is one batch that can be undone.

## Demo data (`server/providers/demo.ts`)

A deterministic generator: the same instrument and date always give the same numbers. Daily paths are geometric random walks pinned at both ends (a Brownian bridge to a trend level), with real splits and distributions applied so `close` is the raw price and `adjClose` the total-return price. Quotes, statistics, dividends and events are all derived from the same series. Every response carries `provenance: "demo"`.
