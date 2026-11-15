// Markets by MP: pure calculation helpers (no DOM). Loaded in the browser and in Node tests.
(function (root) {
  'use strict';

  const CAD_SUFFIXES = ['.TRT', '.TRV', '.NEO', '.CNQ'];

  function currencyFor(symbol) {
    const s = String(symbol || '').toUpperCase();
    return CAD_SUFFIXES.some(x => s.endsWith(x)) ? 'CAD' : 'USD';
  }

  function parseAmount(value, name, { positive = false } = {}) {
    const s = String(value ?? '').trim().replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,6})?$/.test(s)) throw new Error(`${name} must be a number with up to 6 decimal places.`);
    const n = Number(s);
    if (positive && n === 0) throw new Error(`${name} must be greater than zero.`);
    return n;
  }

  function validSymbol(symbol) {
    return /^[A-Z0-9][A-Z0-9.^:-]{0,19}$/.test(String(symbol || '').toUpperCase());
  }

  // Convert an amount in `currency` to CAD. usdcad = CAD per 1 USD.
  function toCAD(amount, currency, usdcad) {
    if (currency === 'CAD') return amount;
    if (!usdcad) return NaN;
    return amount * usdcad;
  }

  const cents = n => Math.round(n * 100) / 100;

  // holdings: [{symbol, shares, avgCost, costCurrency}]
  // quotes: {SYMBOL: {price, prevClose, change, changePct}}
  function summarize(holdings, quotes, usdcad) {
    let value = 0, cost = 0, dayChange = 0, prevValue = 0, priced = 0;
    const rows = holdings.map(h => {
      const q = quotes[h.symbol] || null;
      const cur = currencyFor(h.symbol);
      const costCAD = toCAD(h.shares * h.avgCost, h.costCurrency || cur, usdcad);
      let valueCAD = NaN, dayCAD = NaN, prevCAD = NaN;
      if (q && Number.isFinite(q.price)) {
        valueCAD = toCAD(h.shares * q.price, cur, usdcad);
        if (Number.isFinite(q.prevClose)) {
          prevCAD = toCAD(h.shares * q.prevClose, cur, usdcad);
          dayCAD = valueCAD - prevCAD;
        }
      }
      if (Number.isFinite(valueCAD)) {
        priced++; value += valueCAD; cost += costCAD;
        if (Number.isFinite(dayCAD)) { dayChange += dayCAD; prevValue += prevCAD; }
      }
      return {
        ...h, currency: cur, quote: q,
        costCAD: cents(costCAD), valueCAD: Number.isFinite(valueCAD) ? cents(valueCAD) : null,
        gainCAD: Number.isFinite(valueCAD) ? cents(valueCAD - costCAD) : null,
        gainPct: Number.isFinite(valueCAD) && costCAD > 0 ? (valueCAD - costCAD) / costCAD * 100 : null,
        dayCAD: Number.isFinite(dayCAD) ? cents(dayCAD) : null,
      };
    });
    rows.forEach(r => { r.weight = r.valueCAD != null && value > 0 ? r.valueCAD / value * 100 : 0; });
    rows.sort((a, b) => (b.valueCAD ?? -1) - (a.valueCAD ?? -1));
    return {
      rows, priced,
      value: cents(value), cost: cents(cost), gain: cents(value - cost),
      gainPct: cost > 0 ? (value - cost) / cost * 100 : 0,
      dayChange: cents(dayChange),
      dayPct: prevValue > 0 ? dayChange / prevValue * 100 : 0,
    };
  }

  // Portfolio value over time, in CAD, from each holding's daily closes.
  // series: {SYMBOL: [[date, close], ...]}. On days a symbol has no close (holidays differ between
  // Toronto and New York), its last known close is carried forward. Days before every priced holding
  // has data are skipped, so the line never jumps when a holding "appears".
  function portfolioHistory(holdings, series, usdcad) {
    const held = holdings.filter(h => series[h.symbol] && series[h.symbol].length);
    if (!held.length) return [];
    const dates = [...new Set(held.flatMap(h => series[h.symbol].map(p => p[0])))].sort();
    const idx = Object.fromEntries(held.map(h => [h.symbol, 0]));
    const last = {};
    const out = [];
    for (const d of dates) {
      for (const h of held) {
        const pts = series[h.symbol];
        while (idx[h.symbol] < pts.length && pts[idx[h.symbol]][0] <= d) { last[h.symbol] = pts[idx[h.symbol]][1]; idx[h.symbol]++; }
      }
      if (held.every(h => last[h.symbol] != null)) {
        const v = held.reduce((sum, h) => sum + toCAD(h.shares * last[h.symbol], currencyFor(h.symbol), usdcad), 0);
        if (Number.isFinite(v)) out.push([d, cents(v)]);
      }
    }
    return out;
  }

  // The last `days` calendar days of a [[date, value]] list (all of it when days is 0).
  function lastDays(points, days, today) {
    if (!days || !points.length) return points;
    const end = new Date((today || points[points.length - 1][0]) + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() - days);
    const from = end.toISOString().slice(0, 10);
    const cut = points.filter(p => p[0] >= from);
    return cut.length >= 2 ? cut : points.slice(-2);
  }

  // Alpha Vantage response parsers. Return null when the payload isn't what we expect.
  function parseQuote(json) {
    const q = json && json['Global Quote'];
    if (!q || !q['05. price']) return null;
    const num = k => Number(q[k]);
    return {
      symbol: q['01. symbol'], price: num('05. price'), open: num('02. open'), high: num('03. high'), low: num('04. low'),
      volume: num('06. volume'), latestDay: q['07. latest trading day'], prevClose: num('08. previous close'),
      change: num('09. change'), changePct: parseFloat(String(q['10. change percent'] || '0').replace('%', '')),
    };
  }
  function parseFx(json) {
    const r = json && json['Realtime Currency Exchange Rate'];
    return r && r['5. Exchange Rate'] ? { rate: Number(r['5. Exchange Rate']), at: r['6. Last Refreshed'] } : null;
  }
  function parseDaily(json) {
    const s = json && json['Time Series (Daily)'];
    if (!s) return null;
    return Object.keys(s).sort().map(d => [d, Number(s[d]['4. close'])]);
  }
  function parseSearch(json) {
    return ((json && json.bestMatches) || []).map(m => ({ symbol: m['1. symbol'], name: m['2. name'], region: m['4. region'], currency: m['8. currency'] }));
  }
  // Finnhub (US stocks, live). /quote returns {c: current, d: change, dp: change %, h, l, o, pc: previous close, t: unix time}.
  function parseFinnhubQuote(json) {
    if (!json || !Number.isFinite(json.c) || json.c === 0) return null; // Finnhub answers 0s for unknown symbols
    return {
      price: json.c, change: json.d, changePct: json.dp, high: json.h, low: json.l, open: json.o, prevClose: json.pc,
      latestDay: json.t ? new Date(json.t * 1000).toISOString().slice(0, 10) : null,
    };
  }
  // Finnhub /search: keep plain US listings (no exchange suffix).
  function parseFinnhubSearch(json) {
    return ((json && json.result) || [])
      .filter(m => m.symbol && !m.symbol.includes('.') && /Common Stock|ETP|ETF/i.test(m.type || ''))
      .map(m => ({ symbol: m.symbol, name: m.description, region: 'United States', currency: 'USD' }));
  }
  // Frankfurter (USD to CAD, daily reference rate, no key): {base: "USD", date, rates: {CAD: 1.37}}.
  function parseFrankfurter(json) {
    const r = json && json.rates && Number(json.rates.CAD);
    return r ? { rate: r, at: json.date } : null;
  }
  function apiProblem(json) {
    if (!json) return 'No response from the data provider.';
    if (json.Note || json.Information) return 'The free data limit has been reached for now (25 requests a day). Cached prices are shown.';
    if (json['Error Message']) return 'The data provider did not recognize that request.';
    return null;
  }

  const api = { currencyFor, parseAmount, validSymbol, toCAD, summarize, portfolioHistory, lastDays, parseQuote, parseFx, parseDaily, parseSearch, parseFinnhubQuote, parseFinnhubSearch, parseFrankfurter, apiProblem, cents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
