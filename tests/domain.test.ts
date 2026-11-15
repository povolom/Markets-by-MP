import { describe, expect, it } from 'vitest';
import Big from 'big.js';
import { buildPortfolio, externalFlows } from '../src/domain/portfolio';
import { evaluateRule, step, dedupeKey, referenceHigh, type RuleInput } from '../src/domain/dips';
import { allocateCash, levelsReached, planCommitment, type PlanInput } from '../src/domain/plans';
import { parseCsv, guessMapping, previewImport, txHash } from '../src/domain/csv';
import { timeWeightedReturn, xirr, maxDrawdown } from '../src/domain/stats';
import { sessionStatus } from '../src/domain/market-hours';
import { exposures, fundOverlap, NOT_COVERED } from '../src/domain/exposure';
import { whatIf } from '../src/domain/whatif';
import type { Bar, Instrument, Transaction } from '../src/domain/types';

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), portfolioId: 'p', type: 'buy', instrumentId: null, tradeDate: '2025-01-02', quantity: null, price: null, amount: null, currency: 'CAD', fxToBase: null, fee: '0', note: '', ...p });
const fx = (rates: Record<string, string>) => (c: string) => (rates[c] ? new Big(rates[c]) : null);
const bar = (date: string, close: number, high = close, adj = close): Bar => ({ date, open: String(close), high: String(high), low: String(close), close: String(close), adjClose: String(adj), volume: 0 });

describe('portfolio accounting', () => {
  it('separates contributions from gains, and counts dividends and fees', () => {
    const s = buildPortfolio([
      tx({ type: 'deposit', amount: '1000' }),
      tx({ type: 'buy', instrumentId: 'a', quantity: '10', price: '50', fee: '5' }),
      tx({ type: 'dividend', instrumentId: 'a', amount: '12', tradeDate: '2025-03-01' }),
      tx({ type: 'fee', amount: '3', tradeDate: '2025-03-02' }),
    ], 'CAD', { a: { price: '60', currency: 'CAD', asOf: null } }, fx({}));
    expect(s.cash).toBe('504.00');            // 1000 - 505 + 12 - 3
    expect(s.holdingsValue).toBe('600.00');
    expect(s.totalValue).toBe('1104.00');
    expect(s.netContributions).toBe('1000.00');
    expect(s.investmentGain).toBe('104.00');  // value - contributions, never counting the deposit as a gain
    expect(s.holdings[0].avgCost).toBe('50.50'); // fee included in cost
    expect(s.holdings[0].unrealizedGain).toBe('95.00');
    expect(s.income).toBe('12.00');
    expect(s.fees).toBe('8.00');
  });

  it('uses average cost for realized gains on a sale', () => {
    const s = buildPortfolio([
      tx({ type: 'buy', instrumentId: 'a', quantity: '10', price: '10' }),
      tx({ type: 'buy', instrumentId: 'a', quantity: '10', price: '20', tradeDate: '2025-02-01' }),
      tx({ type: 'sell', instrumentId: 'a', quantity: '5', price: '30', tradeDate: '2025-03-01' }),
    ], 'CAD', { a: { price: '30', currency: 'CAD', asOf: null } }, fx({}));
    expect(s.realizedGain).toBe('75.00');     // 5 x (30 - 15)
    expect(s.holdings[0].quantity).toBe('15');
    expect(s.holdings[0].avgCost).toBe('15.00');
  });

  it('keeps cost basis through a split and never shows the split as a gain', () => {
    const s = buildPortfolio([
      tx({ type: 'buy', instrumentId: 'a', quantity: '2', price: '1000' }),
      tx({ type: 'split', instrumentId: 'a', quantity: '10', tradeDate: '2025-06-10' }),
    ], 'CAD', { a: { price: '100', currency: 'CAD', asOf: null } }, fx({}));
    expect(s.holdings[0].quantity).toBe('20');
    expect(s.holdings[0].costBasis).toBe('2000.00');
    expect(s.holdings[0].unrealizedGain).toBe('0.00');
  });

  it('converts at the trade-date rate for cost and today\'s rate for value', () => {
    const s = buildPortfolio([tx({ type: 'buy', instrumentId: 'u', quantity: '1', price: '100', currency: 'USD', fxToBase: '1.30' })], 'CAD', { u: { price: '100', currency: 'USD', asOf: null } }, fx({ USD: '1.40' }));
    expect(s.holdings[0].costBasis).toBe('130.00');
    expect(s.holdings[0].marketValue).toBe('140.00');
    expect(s.holdings[0].unrealizedGain).toBe('10.00'); // a currency gain with an unchanged price
  });

  it('reports unknown cost basis instead of zero', () => {
    const s = buildPortfolio([tx({ type: 'buy', instrumentId: 'a', quantity: '5', price: null })], 'CAD', { a: { price: '10', currency: 'CAD', asOf: null } }, fx({}));
    expect(s.holdings[0].costBasis).toBeNull();
    expect(s.holdings[0].unrealizedGain).toBeNull();
    expect(s.cash).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/no recorded purchase price/);
  });

  it('treats purchases as money in when no deposits were recorded', () => {
    const { flows, includesCash } = externalFlows([tx({ type: 'buy', instrumentId: 'a', quantity: '2', price: '50', tradeDate: '2025-01-05' })], 'CAD', fx({}));
    expect(includesCash).toBe(false);
    expect(flows.get('2025-01-05')!.toString()).toBe('100');
  });
});

describe('performance', () => {
  it('time-weighted return removes the effect of contributions', () => {
    // 100 grows 10% to 110; the next day it grows 10% again and 100 arrives at the end of that day
    // (valued 121 + 100 = 221). The deposit earned nothing, so the time-weighted return is 21%.
    const r = timeWeightedReturn([{ value: new Big(100), flow: new Big(0) }, { value: new Big(110), flow: new Big(0) }, { value: new Big(221), flow: new Big(100) }]);
    expect(r!.round(2).toString()).toBe('21');
  });
  it('money-weighted return needs dated flows of both signs', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }])).toBeNull();
    expect(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: 110 }])!).toBeCloseTo(10, 0);
  });
  it('max drawdown finds the worst peak-to-trough fall', () => {
    expect(maxDrawdown([{ date: 'a', value: 100 }, { date: 'b', value: 80 }, { date: 'c', value: 120 }, { date: 'd', value: 90 }]).pct).toBeCloseTo(-25);
  });
});

describe('Dip Radar rules', () => {
  const bars = ['2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04'].map((d, i) => bar(d, [100, 110, 105, 100][i], [101, 112, 106, 100][i]));
  const rule = (p: Partial<RuleInput> = {}): RuleInput => ({ kind: 'below_rolling_high', threshold: '10', windowDays: 30, basis: 'close', resetBand: '2', cooldownHours: 24, ...p });

  it('matches exactly at the threshold, not before', () => {
    expect(evaluateRule(rule(), bars, '99', null).matched).toBe(true);     // exactly 10% below 110
    expect(evaluateRule(rule(), bars, '99.01', null).matched).toBe(false);
  });
  it('uses intraday highs only when asked', () => {
    expect(referenceHigh(bars, '2025-06-04', 30, 'close')!.value.toString()).toBe('110');
    expect(referenceHigh(bars, '2025-06-04', 30, 'intraday')!.value.toString()).toBe('112');
  });
  it('does not treat a split as a dip (adjusted prices)', () => {
    // Raw price halves on a 2-for-1 split; adjusted history already reflects it.
    const split = [bar('2025-06-01', 200, 200, 100), bar('2025-06-02', 100, 100, 100)];
    expect(evaluateRule(rule(), split, '100', null).matched).toBe(false);
  });
  it('fires once on crossing, re-arms only after the reset band, and respects the cooldown', () => {
    const r = rule(); const now = new Date('2025-06-04T15:00:00Z');
    const hit = evaluateRule(r, bars, '98', null);
    const first = step({ armed: true, lastTriggeredAt: null }, hit, r, now);
    expect(first.fire).toBe(true);
    const again = step(first.next, hit, r, now);
    expect(again.fire).toBe(false); expect(again.suppressedBy).toBe('disarmed');
    expect(step(first.next, evaluateRule(r, bars, '100', null), r, now).next.armed).toBe(false); // 9.1% below: not yet reset
    const reset = step(first.next, evaluateRule(r, bars, '101.5', null), r, now);              // 7.7% below: past 8%
    expect(reset.next.armed).toBe(true);
    const cooled = step(reset.next, hit, r, new Date('2025-06-04T20:00:00Z'));
    expect(cooled.fire).toBe(false); expect(cooled.suppressedBy).toBe('cooldown');
  });
  it('de-duplicates by rule, instrument and market date', () => {
    expect(dedupeKey('r', 'i', '2025-06-04')).toBe('r:i:2025-06-04');
  });
  it('explains when average cost is unknown', () => {
    expect(evaluateRule(rule({ kind: 'below_avg_cost' }), bars, '90', null).unavailable).toMatch(/average cost/);
  });
});

describe('Buy Plans', () => {
  const plan = (p: Partial<PlanInput>): PlanInput => ({ id: 'x', name: 'x', mode: 'regular', portfolioId: 'p', schedule: 'monthly', regularAmount: '500', levels: [], maxTotal: '0', currency: 'CAD', status: 'active', ...p });
  it('never counts the same cash twice', () => {
    const a = allocateCash('1000', [plan({ id: 'a', maxTotal: '800' }), plan({ id: 'b', maxTotal: '800' })]);
    expect(a.rows.map(r => r.covered)).toEqual(['800.00', '200.00']);
    expect(a.rows[1].shortfall).toBe('600.00');
    expect(a.overcommitted).toBe(true);
  });
  it('reports unknown cash as unknown', () => {
    expect(allocateCash(null, [plan({})]).known).toBe(false);
  });
  it('only reaches the levels the drop has passed', () => {
    const levels = [{ dropPct: '5', amount: '100' }, { dropPct: '10', amount: '200' }];
    expect(levelsReached(levels, '-7.50')).toHaveLength(1);
    expect(levelsReached(levels, '2.00')).toHaveLength(0);
    expect(planCommitment(plan({ mode: 'hybrid', levels })).dipLevelsTotal).toBe('300.00');
  });
});

describe('CSV import', () => {
  const csv = 'Date,Type,Symbol,Quantity,Price,Amount,Currency\n2025-01-02,Buy,AAPL,2,"1,000.50",,USD\n2025-01-02,Buy,AAPL,2,"1,000.50",,USD\n2025-13-40,Buy,AAPL,1,10,,USD\n2025-01-03,Deposit,,,,500,CAD\n2025-01-04,Buy,ZZZZ,1,10,,USD\n';
  const rows = parseCsv(csv);
  const resolve = (s: string) => (s === 'AAPL' ? 'xnas.aapl' : null);
  it('parses quoted fields and guesses the mapping', () => {
    expect(rows[1][4]).toBe('1,000.50');
    expect(guessMapping(rows[0])).toMatchObject({ date: 0, type: 1, symbol: 2, quantity: 3, price: 4 });
  });
  it('validates rows and keeps two identical rows as two trades', () => {
    const p = previewImport(rows, guessMapping(rows[0]), { hasHeader: true, dateFormat: 'ymd', defaultCurrency: 'CAD', today: '2026-01-01' }, resolve, new Set());
    expect(p.map(r => r.status)).toEqual(['ok', 'ok', 'error', 'ok', 'error']);
    expect(p[0].tx!.price).toBe('1000.50');
    expect(p[0].tx!.dedupeHash).not.toBe(p[1].tx!.dedupeHash);
    expect(p[4].errors[0]).toMatch(/coverage/);
  });
  it('marks rows already in the portfolio as duplicates on re-import', () => {
    const first = previewImport(rows, guessMapping(rows[0]), { hasHeader: true, dateFormat: 'ymd', defaultCurrency: 'CAD', today: '2026-01-01' }, resolve, new Set());
    const existing = new Set(first.filter(r => r.tx).map(r => r.tx!.dedupeHash));
    const again = previewImport(rows, guessMapping(rows[0]), { hasHeader: true, dateFormat: 'ymd', defaultCurrency: 'CAD', today: '2026-01-01' }, resolve, existing);
    expect(again.filter(r => r.status === 'duplicate')).toHaveLength(3);
  });
  it('hashes equal values equally regardless of formatting', () => {
    const t = { type: 'buy', tradeDate: '2025-01-02', instrumentId: 'a', quantity: '2.0', price: '10.50', amount: null, currency: 'CAD' };
    expect(txHash(t)).toBe(txHash({ ...t, quantity: '2', price: '10.5' }));
  });
});

describe('market sessions', () => {
  it('knows when New York and Toronto are open, in their own time zones', () => {
    expect(sessionStatus('XNAS', 'stock', new Date('2026-11-16T15:00:00Z'))).toBe('open');   // 10:00 New York, Monday
    expect(sessionStatus('XNAS', 'stock', new Date('2026-11-16T12:00:00Z'))).toBe('pre');
    expect(sessionStatus('XTSE', 'stock', new Date('2026-11-16T22:00:00Z'))).toBe('closed');
    expect(sessionStatus('XNAS', 'stock', new Date('2026-11-14T15:00:00Z'))).toBe('closed'); // Saturday
    expect(sessionStatus('CRYPTO', 'crypto', new Date('2026-11-14T15:00:00Z'))).toBe('always_open');
  });
});

describe('X-Ray and What-If', () => {
  const inst = (id: string, cls: Instrument['assetClass'], sector: string | null = 'Tech'): Instrument => ({ id, symbol: id, name: id.toUpperCase(), assetClass: cls, exchange: 'X', exchangeName: 'X', currency: 'CAD', timezone: 'UTC', country: 'US', sector, industry: null, tradable: true, description: '' });
  const lookup = (id: string) => ({ a: inst('a', 'stock'), f: inst('f', 'etf', null), g: inst('g', 'etf', null) } as Record<string, Instrument>)[id];
  const comp = (id: string) => ({
    f: { asOf: '2026-09-30', coveragePct: '40.00', holdings: [{ instrumentId: 'a', name: 'A', weightPct: '10.00', sector: 'Tech', country: 'US' }, { instrumentId: 'b', name: 'B', weightPct: '30.00', sector: 'Tech', country: 'US' }], sectors: { Tech: '60.00' }, countries: { US: '100.00' } },
    g: { asOf: '2026-09-30', coveragePct: '20.00', holdings: [{ instrumentId: 'a', name: 'A', weightPct: '20.00', sector: 'Tech', country: 'US' }], sectors: {}, countries: {} },
  } as any)[id];

  it('combines direct and look-through exposure and keeps the undescribed part visible', () => {
    const e = exposures([{ instrumentId: 'a', value: new Big(100) }, { instrumentId: 'f', value: new Big(1000) }], null, lookup, comp);
    const a = e.companies.find(c => c.instrumentId === 'a')!;
    expect(a.value).toBe('200.00');          // 100 direct + 10% of 1000
    expect(a.directValue).toBe('100.00');
    expect(e.companies.find(c => c.key === NOT_COVERED)!.value).toBe('600.00');
    expect(e.sectors.find(s => s.key === NOT_COVERED)!.value).toBe('400.00');
  });
  it('measures fund overlap with the smaller weight', () => {
    expect(fundOverlap(comp('f'), comp('g')).overlapPct).toBe('10.00');
  });
  it('simulates without touching the inputs, and flags spending more cash than you have', () => {
    const holdings = [{ instrumentId: 'a', quantity: '10', marketValue: '100', avgCost: '8', costKnown: true, price: '10' }];
    const r = whatIf({ holdings, cash: '50', action: { type: 'buy', instrumentId: 'a', quantity: '10', price: '10', fxToBase: '1', fee: '0', funding: 'cash' }, dividendYieldPct: () => null }, lookup, comp);
    expect(r.cashAfter).toBe('-50.00');
    expect(r.warnings[0]).toMatch(/more than your/);
    expect(r.holdings[0].avgCostAfter).toBe('9.00');
    expect(holdings[0].quantity).toBe('10');
    const newMoney = whatIf({ holdings, cash: '50', action: { type: 'buy', instrumentId: 'a', quantity: '10', price: '10', fxToBase: '1', fee: '0', funding: 'new_money' }, dividendYieldPct: () => null }, lookup, comp);
    expect(newMoney.cashAfter).toBe('50.00'); expect(newMoney.newMoney).toBe('100.00');
  });
});
