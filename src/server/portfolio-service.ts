// Portfolio service: loads a user's own transactions and turns them into holdings, performance,
// X-Ray and What-If results with the shared domain code. Every function takes the owner's user ID.
import Big from 'big.js';
import { D, ZERO, money, pct } from '../domain/decimal';
import { exposures, fundOverlap } from '../domain/exposure';
import { buildPortfolio, externalFlows, type PortfolioSummary } from '../domain/portfolio';
import { maxDrawdown, timeWeightedReturn, xirr, annualizedVolatility, fmtPct } from '../domain/stats';
import { whatIf, type WhatIfAction } from '../domain/whatif';
import type { Bar, Transaction } from '../domain/types';
import { all, first } from './db';
import { notFound, ApiError } from './http';
import type { Market } from './market';

export interface PortfolioRow { id: string; user_id: string; name: string; kind: string; created_at: string }

export async function ownedPortfolio(db: D1Database, userId: string, id: string) {
  const p = await first<PortfolioRow>(db, 'SELECT * FROM portfolios WHERE id = ? AND user_id = ?', id, userId);
  if (!p) throw notFound('Portfolio');
  return p;
}

export const toTx = (r: any): Transaction & { importBatchId: string | null; dedupeHash: string; createdAt: string } => ({
  id: r.id, portfolioId: r.portfolio_id, type: r.type, instrumentId: r.instrument_id, tradeDate: r.trade_date, quantity: r.quantity, price: r.price,
  amount: r.amount, currency: r.currency, fxToBase: r.fx_to_base, fee: r.fee, note: r.note, importBatchId: r.import_batch_id, dedupeHash: r.dedupe_hash, createdAt: r.created_at,
});

export async function transactions(db: D1Database, userId: string, portfolioId: string) {
  return (await all(db, 'SELECT * FROM transactions WHERE portfolio_id = ? AND user_id = ? ORDER BY trade_date, created_at', portfolioId, userId)).map(toTx);
}

export async function baseCurrency(db: D1Database, userId: string): Promise<string> {
  return (await first<{ base_currency: string }>(db, 'SELECT base_currency FROM profiles WHERE user_id = ?', userId))?.base_currency ?? 'CAD';
}

/** Current FX rates (currency -> base) for every currency involved. */
async function fxTable(m: Market, currencies: string[], base: string) {
  const t = new Map<string, Big>([[base, D(1)]]);
  await Promise.all([...new Set(currencies)].filter(c => c !== base).map(async c => t.set(c, D(await m.fx(c, base)))));
  return t;
}

export async function summarize(db: D1Database, m: Market, userId: string, portfolioId: string) {
  const p = await ownedPortfolio(db, userId, portfolioId);
  const base = await baseCurrency(db, userId);
  const txs = await transactions(db, userId, portfolioId);
  const ids = [...new Set(txs.map(t => t.instrumentId).filter(Boolean) as string[])];
  const quotes = await Promise.all(ids.map(id => m.quote(id).catch(() => null)));
  const prices = Object.fromEntries(quotes.filter(Boolean).map(q => [q!.instrumentId, { price: q!.price, currency: q!.currency, asOf: q!.meta.observedAt }]));
  const fx = await fxTable(m, [...txs.map(t => t.currency), ...quotes.filter(Boolean).map(q => q!.currency)], base);
  const summary = buildPortfolio(txs, base, prices, c => fx.get(c) ?? null);
  return { portfolio: { id: p.id, name: p.name, kind: p.kind, createdAt: p.created_at }, summary, fx: Object.fromEntries([...fx].map(([k, v]) => [k, v.toString()])), quotes: quotes.filter(Boolean), transactionCount: txs.length, txs };
}

/** Daily valuation from transactions and historical prices; never inferred from current holdings alone. */
export async function performance(db: D1Database, m: Market, userId: string, portfolioId: string, benchmarkId: string | null) {
  const { summary, txs, fx } = await summarize(db, m, userId, portfolioId);
  if (!txs.length) return { available: false, reason: 'No transactions yet.', series: [], summary };
  if (txs.some(t => (t.type === 'buy' || t.type === 'sell') && t.price == null)) return { available: false, reason: 'Some trades have no price, so past values can\'t be calculated reliably.', series: [], summary };
  const base = summary.baseCurrency;
  const ids = [...new Set(txs.map(t => t.instrumentId).filter(Boolean) as string[])];
  const hist = new Map<string, Bar[]>();
  await Promise.all(ids.map(async id => hist.set(id, await m.fullHistory(id))));
  const fxIds: Record<string, string> = { USD: 'fx.usdcad' };
  const fxHist = base === 'CAD' ? await m.fullHistory('fx.usdcad') : await m.fullHistory('fx.usdcad');
  let fxI = 0;
  const fxAt = (ccy: string, date: string): Big => {
    if (ccy === base) return D(1);
    while (fxI + 1 < fxHist.length && fxHist[fxI + 1].date <= date) fxI++;
    const usdcad = D(fxHist[fxI].close);
    if (ccy === 'USD' && base === 'CAD') return usdcad;
    if (ccy === 'CAD' && base === 'USD') return D(1).div(usdcad);
    return D(fx[ccy] ?? 1);
  };
  void fxIds;
  const start = txs[0].tradeDate;
  const dates = (hist.get(ids[0]) ?? fxHist).map(b => b.date).filter(d => d >= start);
  for (const id of ids) for (const b of hist.get(id)!) if (b.date >= start && !dates.includes(b.date)) dates.push(b.date);
  dates.sort();
  const { flows, includesCash } = externalFlows(txs, base, c => D(fx[c] ?? 1));
  // One pass over the dates, applying each transaction once: quantities and cash at the end of each day.
  const ordered = [...txs].sort((x, y) => x.tradeDate.localeCompare(y.tradeDate));
  const qty = new Map<string, Big>(); let cash = ZERO; let k = 0;
  const cursor = new Map<string, number>();
  const closeOn = (id: string, date: string): Big | null => {
    const bars = hist.get(id)!; let i = cursor.get(id) ?? 0;
    while (i + 1 < bars.length && bars[i + 1].date <= date) i++;
    cursor.set(id, i);
    return bars[i] && bars[i].date <= date ? D(bars[i].close) : null;
  };
  const points = dates.map(date => {
    for (; k < ordered.length && ordered[k].tradeDate <= date; k++) {
      const t = ordered[k];
      const r = t.currency === base ? D(1) : D(t.fxToBase ?? fx[t.currency] ?? 1);
      const fee = D(t.fee || 0).times(r);
      const cur = t.instrumentId ? qty.get(t.instrumentId) ?? ZERO : ZERO;
      if (t.type === 'buy') { qty.set(t.instrumentId!, cur.plus(D(t.quantity))); if (includesCash) cash = cash.minus(D(t.quantity).times(D(t.price)).times(r)).minus(fee); }
      if (t.type === 'sell') { const n = cur.minus(D(t.quantity)); qty.set(t.instrumentId!, n.lt(0) ? ZERO : n); if (includesCash) cash = cash.plus(D(t.quantity).times(D(t.price)).times(r)).minus(fee); }
      if (t.type === 'split') qty.set(t.instrumentId!, cur.times(D(t.quantity)));
      if (!includesCash) continue;
      if (t.type === 'deposit' || t.type === 'dividend' || t.type === 'interest') cash = cash.plus(D(t.amount).times(r));
      if (t.type === 'withdrawal' || t.type === 'fee') cash = cash.minus(D(t.amount).times(r));
    }
    let v = cash;
    for (const [id, q] of qty) { if (q.eq(0)) continue; const c = closeOn(id, date); if (c) v = v.plus(q.times(c).times(fxAt(m.instrument(id).currency, date))); }
    return { date, value: v, flow: flows.get(date) ?? ZERO };
  });
  // Flows on non-trading days are carried to the next valuation date.
  const flowDates = [...flows.keys()].filter(d => !dates.includes(d));
  for (const d of flowDates) { const p = points.find(x => x.date > d); if (p) p.flow = p.flow.plus(flows.get(d)!); }
  // TWR treats the first day's value as the starting point, so its flow isn't counted as a gain.
  const twr = timeWeightedReturn(points);
  const index: { date: string; value: string; indexed: string }[] = [];
  let growth = D(1);
  points.forEach((p, i) => {
    if (i > 0 && points[i - 1].value.gt(0)) growth = growth.times(p.value.minus(p.flow).div(points[i - 1].value));
    index.push({ date: p.date, value: money(p.value), indexed: growth.times(100).round(4).toString() });
  });
  const last = points[points.length - 1];
  const invFlows = [...[...flows.entries()].sort().map(([date, f]) => ({ date, amount: -Number(f) })), { date: last.date, amount: Number(last.value) }];
  const mwr = xirr(invFlows);
  let bench: null | { instrumentId: string; returnPct: string | null; series: { date: string; indexed: string }[]; method: string } = null;
  if (benchmarkId) {
    const bi = m.instrument(benchmarkId); const bb = (await m.fullHistory(benchmarkId)).filter(b => b.date >= points[0].date && b.date <= last.date);
    if (bb.length > 1) {
      const v0 = D(bb[0].adjClose).times(fxAt(bi.currency, bb[0].date));
      const series = bb.map(b => ({ date: b.date, indexed: D(b.adjClose).times(fxAt(bi.currency, b.date)).div(v0).times(100).round(4).toString() }));
      bench = { instrumentId: benchmarkId, returnPct: pct(D(series[series.length - 1].indexed).minus(100)), series, method: `Total return (adjusted close) converted to ${base} at each day's rate, over the same dates as the portfolio.` };
    }
  }
  const dailyR = index.slice(1).map((p, i) => Number(p.indexed) / Number(index[i].indexed) - 1);
  return {
    available: true, baseCurrency: base, from: points[0].date, to: last.date,
    timeWeightedReturnPct: twr ? pct(twr) : null,
    moneyWeightedReturnPct: mwr == null ? null : fmtPct(mwr),
    moneyWeightedNote: mwr == null ? 'Shown when there are dated cash flows covering at least 30 days.' : 'Annualized. Reflects the timing and size of your contributions.',
    volatilityPct: fmtPct(annualizedVolatility(dailyR)),
    maxDrawdown: (() => { const d = maxDrawdown(index.map(p => ({ date: p.date, value: Number(p.indexed) }))); return { pct: fmtPct(d.pct), from: d.from, to: d.to }; })(),
    method: includesCash
      ? 'Time-weighted return links daily returns and removes the effect of deposits and withdrawals. Cash is part of the portfolio.'
      : 'No deposits were recorded, so the portfolio is measured as its holdings: each purchase counts as money in and each sale as money out, never as a gain.',
    series: index, benchmark: bench, summary,
  };
}

export async function xray(db: D1Database, m: Market, userId: string, portfolioId: string) {
  const { summary } = await summarize(db, m, userId, portfolioId);
  const positions = summary.holdings.filter(h => h.marketValue).map(h => ({ instrumentId: h.instrumentId, value: D(h.marketValue) }));
  const cash = summary.cash ? D(summary.cash) : null;
  const exp = exposures(positions, cash, id => m.lookup(id), id => m.composition(id));
  const funds = summary.holdings.map(h => m.instrument(h.instrumentId)).filter(i => (i.assetClass === 'etf' || i.assetClass === 'mutual_fund') && m.composition(i.id));
  const overlaps = [];
  for (let i = 0; i < funds.length; i++) for (let j = i + 1; j < funds.length; j++) overlaps.push({ a: funds[i].id, b: funds[j].id, ...fundOverlap(m.composition(funds[i].id)!, m.composition(funds[j].id)!) });
  return {
    ...exp, overlaps, baseCurrency: summary.baseCurrency,
    unpricedHoldings: summary.holdings.filter(h => !h.marketValue).map(h => h.instrumentId),
    methodology: [
      'Direct exposure is each holding\'s market value as a share of the whole portfolio, including cash.',
      'Look-through exposure splits each fund into its published top holdings, using the date and coverage shown. The undescribed part of a fund is listed as "Not covered by holdings data", never as zero.',
      'A company held directly and through funds is combined into one line. Funds held inside funds are not expanded again, so nothing is counted twice.',
      'Overlap between two funds is the sum, over companies both describe, of the smaller weight.',
    ],
  };
}

export async function simulate(db: D1Database, m: Market, userId: string, portfolioId: string, action: Omit<WhatIfAction, 'price' | 'fxToBase'> & { price?: string; fxToBase?: string }) {
  const { summary } = await summarize(db, m, userId, portfolioId);
  let price = action.price, fx = action.fxToBase;
  if (action.type !== 'contribute') {
    if (!action.instrumentId) throw new ApiError(400, 'bad_request', 'Choose an instrument.');
    const inst = m.instrument(action.instrumentId);
    if (!inst.tradable) throw new ApiError(400, 'bad_request', `${inst.name} can't be bought directly.`);
    price ??= (await m.quote(inst.id)).price;
    fx ??= await m.fx(inst.currency, summary.baseCurrency);
  }
  const yields = new Map<string, string | null>();
  for (const id of new Set([...summary.holdings.map(h => h.instrumentId), ...(action.instrumentId ? [action.instrumentId] : [])])) yields.set(id, (await m.statistics(id)).dividendYield);
  const result = whatIf({ holdings: summary.holdings, cash: summary.cash, action: { ...action, price: price ?? '0', fxToBase: fx ?? '1', fee: action.fee ?? '0' }, dividendYieldPct: id => yields.get(id) ?? null }, id => m.lookup(id), id => m.composition(id));
  return { ...result, baseCurrency: summary.baseCurrency, assumedPrice: price ?? null, assumedFx: fx ?? null, notice: 'A simulation only. Nothing was recorded and no order was placed.' };
}

export type Summary = PortfolioSummary;
