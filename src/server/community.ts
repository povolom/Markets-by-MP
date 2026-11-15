// Community portfolios: what people choose to share, shown as percentages only. Sample portfolios are
// labelled examples so the page is useful before many people share.
import Big from 'big.js';
import { D, pct } from '../domain/decimal';
import { exposures } from '../domain/exposure';
import { all, first } from './db';
import type { Market } from './market';
import { summarize } from './portfolio-service';

export const SAMPLE_PORTFOLIOS = [
  { id: 'sample-one-etf', title: 'One-ETF simplicity', handle: 'sample_allinone', note: 'Everything in one globally diversified ETF, plus a small cash buffer.', since: '2022-03', weights: { 'xtse.xeqt': '95', cash: '5' } },
  { id: 'sample-cdn-dividend', title: 'Canadian dividend builder', handle: 'sample_dividends', note: 'Banks, pipelines and telecoms for income, with a broad ETF underneath.', since: '2021-11', weights: { 'xtse.ry': '12', 'xtse.td': '11', 'xtse.bns': '8', 'xtse.enb': '12', 'xtse.trp': '8', 'xtse.bce': '6', 'xtse.t': '6', 'xtse.fts': '7', 'xtse.xei': '25', cash: '5' } },
  { id: 'sample-tech-tilt', title: 'S&P 500 core, tech tilt', handle: 'sample_growth', note: 'An index core with a handful of large tech companies on top.', since: '2023-01', weights: { 'xtse.vfv': '55', 'xnas.qqq': '15', 'xnas.nvda': '8', 'xnas.msft': '8', 'xnas.aapl': '7', 'xtse.shop': '5', cash: '2' } },
  { id: 'sample-three-fund', title: 'Three-fund global', handle: 'sample_threefund', note: 'Canada, the rest of the world, and bonds, rebalanced once a year.', since: '2022-06', weights: { 'xtse.xiu': '30', 'xtse.xaw': '45', 'xtse.zag': '25' } },
  { id: 'sample-crypto-sleeve', title: 'Index plus a crypto sleeve', handle: 'sample_crypto', note: 'Mostly index funds, with a small, capped crypto position.', since: '2024-02', weights: { 'arcx.voo': '50', 'xtse.xaw': '35', 'crypto.btc-usd': '8', 'crypto.eth-usd': '4', cash: '3' } },
];

/** Percentages-only view of a set of holdings. */
export function shareView(m: Market, weights: { instrumentId: string; value: Big }[], cash: Big | null, showHoldings: boolean) {
  const exp = exposures(weights, cash, id => m.lookup(id), id => m.composition(id));
  const total = D(exp.totalValue);
  const holdings = weights.filter(w => w.value.gt(0)).sort((a, b) => b.value.cmp(a.value))
    .map(w => { const i = m.lookup(w.instrumentId); return { instrumentId: w.instrumentId, symbol: i?.symbol ?? w.instrumentId, name: i?.name ?? '', assetClass: i?.assetClass ?? null, weightPct: total.gt(0) ? pct(w.value.div(total).times(100)) : '0.00' }; });
  return {
    holdingCount: holdings.length,
    holdings: showHoldings ? holdings : [],
    cashPct: cash && total.gt(0) ? pct(cash.div(total).times(100)) : '0.00',
    assetClasses: exp.assetClasses.map(r => ({ key: r.key, pct: r.pct })),
    sectors: exp.sectors.slice(0, 8).map(r => ({ key: r.key, pct: r.pct })),
    countries: exp.countries.slice(0, 6).map(r => ({ key: r.key, pct: r.pct })),
    largestCompanyPct: exp.largestCompanyPct,
  };
}

export function sampleView(m: Market, s: typeof SAMPLE_PORTFOLIOS[number]) {
  const ws = Object.entries(s.weights).filter(([k]) => k !== 'cash').map(([instrumentId, w]) => ({ instrumentId, value: D(w) }));
  return { id: s.id, kind: 'sample' as const, title: s.title, note: s.note, owner: { handle: s.handle, name: 'Sample investor' }, since: s.since, provenance: 'sample', ...shareView(m, ws, s.weights.cash ? D(s.weights.cash) : null, true) };
}

export async function sharedView(db: D1Database, m: Market, row: any) {
  const s = await summarize(db, m, row.user_id, row.portfolio_id);
  const ws = s.summary.holdings.filter(h => h.marketValue).map(h => ({ instrumentId: h.instrumentId, value: D(h.marketValue) }));
  const firstTx = s.txs[0]?.tradeDate ?? null;
  return {
    id: row.portfolio_id, kind: 'shared' as const, title: row.title, note: row.note,
    owner: { handle: row.handle ?? 'investor', name: row.display_name || row.handle || 'Investor' },
    since: firstTx ? firstTx.slice(0, 7) : null, provenance: s.portfolio.kind === 'connected' ? 'connected' : 'manual',
    ...shareView(m, ws, s.summary.cash ? D(s.summary.cash) : null, row.show_holdings === 1),
  };
}

/** The viewer's own held instruments, for "you both hold". */
export async function viewerHoldings(db: D1Database, userId: string) {
  return new Set((await all<{ instrument_id: string }>(db, "SELECT DISTINCT instrument_id FROM transactions WHERE user_id = ? AND type = 'buy' AND instrument_id IS NOT NULL", userId)).map(r => r.instrument_id));
}

export async function sharedRow(db: D1Database, portfolioId: string) {
  return first<any>(db, 'SELECT s.*, p.handle, p.display_name FROM shared_portfolios s JOIN profiles p ON p.user_id = s.user_id WHERE s.portfolio_id = ?', portfolioId);
}
