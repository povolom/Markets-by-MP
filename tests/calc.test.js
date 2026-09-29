// Run: node tests/calc.test.js
const assert = require('assert');
const C = require('../docs/portfolio-lab/calc.js');
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
console.log('calc tests passed');
