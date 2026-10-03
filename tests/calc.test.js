// Run: node tests/calc.test.js
const assert = require('assert');
const C = require('../docs/calc.js');
assert.strictEqual(C.currencyFor('SHOP.TRT'), 'CAD');
assert.strictEqual(C.currencyFor('AAPL'), 'USD');
assert.throws(() => C.parseAmount('abc', 'Shares'));
assert.throws(() => C.parseAmount('0', 'Shares', { positive: true }));
assert.strictEqual(C.parseAmount('2.5', 'Shares'), 2.5);
// Same example as the Python app's README: 2.5 shares, cost 10, price 12 (CAD)
let s = C.summarize([{ symbol: 'EX.TRT', shares: 2.5, avgCost: 10, costCurrency: 'CAD' }], { 'EX.TRT': { price: 12, prevClose: 11 } }, 1.37);
assert.deepStrictEqual([s.cost, s.value, s.gain, s.dayChange], [25, 30, 5, 2.5]);
// USD holding converts to CAD at the given rate
s = C.summarize([{ symbol: 'AAPL', shares: 2, avgCost: 100, costCurrency: 'USD' }], { AAPL: { price: 110, prevClose: 100 } }, 1.4);
assert.deepStrictEqual([s.cost, s.value, s.gain, s.dayChange], [280, 308, 28, 28]);
// Weights sum to ~100
s = C.summarize([{ symbol: 'A.TRT', shares: 1, avgCost: 1 }, { symbol: 'B.TRT', shares: 3, avgCost: 1 }], { 'A.TRT': { price: 10 }, 'B.TRT': { price: 10 } }, 1);
assert.strictEqual(Math.round(s.rows.reduce((a, r) => a + r.weight, 0)), 100);
// Unpriced holdings are excluded from totals
s = C.summarize([{ symbol: 'X.TRT', shares: 1, avgCost: 5 }], {}, 1.3);
assert.strictEqual(s.priced, 0); assert.strictEqual(s.value, 0);
// Parsers
assert.strictEqual(C.parseQuote({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '120.5', '08. previous close': '118', '09. change': '2.5', '10. change percent': '2.1186%' } }).changePct, 2.1186);
assert.strictEqual(C.parseFx({ 'Realtime Currency Exchange Rate': { '5. Exchange Rate': '1.3712' } }).rate, 1.3712);
assert.ok(C.apiProblem({ Information: 'rate limit' }));
// Portfolio history: CAD + USD holdings, a holiday gap carried forward, early days skipped
let hist = C.portfolioHistory(
  [{ symbol: 'A.TRT', shares: 2 }, { symbol: 'B', shares: 1 }],
  { 'A.TRT': [['2026-01-01', 10], ['2026-01-02', 11], ['2026-01-05', 12]], B: [['2026-01-02', 100], ['2026-01-05', 110]] },
  1.5);
// Jan 1: B has no data yet, so it's skipped. Jan 2: 2*11 + 100*1.5 = 172. Jan 5: 2*12 + 110*1.5 = 189.
assert.deepStrictEqual(hist, [['2026-01-02', 172], ['2026-01-05', 189]]);
// A day only one market traded: the other's last close carries forward
hist = C.portfolioHistory([{ symbol: 'A.TRT', shares: 1 }, { symbol: 'B', shares: 1 }],
  { 'A.TRT': [['2026-02-02', 10], ['2026-02-03', 12]], B: [['2026-02-02', 20]] }, 1);
assert.deepStrictEqual(hist, [['2026-02-02', 30], ['2026-02-03', 32]]);
assert.deepStrictEqual(C.portfolioHistory([{ symbol: 'Z', shares: 1 }], {}, 1), []);
// lastDays keeps the window and never returns fewer than 2 points
const pts = [['2026-01-01', 1], ['2026-01-20', 2], ['2026-01-30', 3], ['2026-02-01', 4]];
assert.deepStrictEqual(C.lastDays(pts, 7).map(p => p[0]), ['2026-01-30', '2026-02-01']);
assert.strictEqual(C.lastDays(pts, 0).length, 4);
assert.strictEqual(C.lastDays(pts, 1).length, 2);
// Finnhub quote: a real answer, and the all-zero answer it gives for unknown symbols
const fq = C.parseFinnhubQuote({ c: 226.3, d: -2.9, dp: -1.265, h: 229, l: 225.1, o: 228, pc: 229.2, t: 1790971200 });
assert.deepStrictEqual([fq.price, fq.prevClose, fq.changePct, fq.latestDay], [226.3, 229.2, -1.265, '2026-10-02']);
assert.strictEqual(C.parseFinnhubQuote({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }), null);
// Finnhub search keeps US stocks and ETFs only
assert.deepStrictEqual(C.parseFinnhubSearch({ result: [{ symbol: 'AAPL', description: 'APPLE INC', type: 'Common Stock' }, { symbol: 'AAPL.MX', description: 'APPLE INC', type: 'Common Stock' }, { symbol: 'AAPL250117C', description: 'option', type: 'Option' }] }).map(m => m.symbol), ['AAPL']);
// Frankfurter rate
assert.strictEqual(C.parseFrankfurter({ base: 'USD', date: '2026-10-02', rates: { CAD: 1.424 } }).rate, 1.424);
assert.strictEqual(C.parseFrankfurter({}), null);
console.log('calc tests passed');
