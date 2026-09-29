// Portfolio Lab: pure calculation helpers (no DOM). Loaded in the browser and in Node tests.
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
  function apiProblem(json) {
    if (!json) return 'No response from the data provider.';
    if (json.Note || json.Information) return 'The free data limit has been reached for now (25 requests a day). Cached prices are shown.';
    if (json['Error Message']) return 'The data provider did not recognize that request.';
    return null;
  }

  const api = { currencyFor, parseAmount, validSymbol, toCAD, summarize, parseQuote, parseFx, parseDaily, parseSearch, apiProblem, cents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
