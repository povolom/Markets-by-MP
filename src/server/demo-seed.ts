// Seeds a guest's demo workspace. Only ever runs for anonymous (guest) users; real accounts start
// empty and are never filled with made-up holdings. Demo transactions use the demo provider's own
// prices, FX and dividends on each date, so every number in the demo agrees with the API.
import { D, money } from '../domain/decimal';
import { txHash } from '../domain/csv';
import type { Market } from './market';
import { first, stmt } from './db';
import { newId } from './http';

const BUYS: { id: string; date: string; qty: string }[] = [
  { id: 'xtse.xeqt', date: '2024-01-03', qty: '220' },
  { id: 'xtse.vfv', date: '2024-01-03', qty: '25' },
  { id: 'xnas.aapl', date: '2024-03-04', qty: '12' },
  { id: 'xtse.td', date: '2024-06-03', qty: '30' },
  { id: 'xtse.xeqt', date: '2025-01-03', qty: '150' },
  { id: 'xnas.qqq', date: '2025-01-03', qty: '4' },
  { id: 'crypto.btc-usd', date: '2025-02-03', qty: '0.02' },
];

export async function seedDemo(db: D1Database, m: Market, userId: string) {
  const existing = await first(db, 'SELECT 1 FROM portfolios WHERE user_id = ? AND kind = ?', userId, 'demo');
  if (existing) return { seeded: false };
  const pid = newId('pf'), wl = newId('wl'), wl2 = newId('wl');
  const base = 'CAD';
  const rows: { type: string; id: string | null; date: string; qty: string | null; price: string | null; amount: string | null; ccy: string; fx: string | null }[] = [];
  // Purchases at each date's demo close, then contributions sized to cover them (rounded up to the next
  // $1,000 plus a cash cushion), so the demo account never shows a negative cash balance.
  const buys: typeof rows = [];
  const costByYear = new Map<string, number>();
  for (const b of BUYS) {
    const inst = m.instrument(b.id);
    const bars = await m.fullHistory(b.id);
    const bar = bars.find(x => x.date >= b.date)!;
    const fx = inst.currency === base ? null : await m.fx(inst.currency, base, bar.date);
    buys.push({ type: 'buy', id: b.id, date: bar.date, qty: b.qty, price: bar.close, amount: null, ccy: inst.currency, fx });
    const cost = Number(b.qty) * Number(bar.close) * Number(fx ?? 1) + 4.95 * Number(fx ?? 1);
    costByYear.set(b.date.slice(0, 4), (costByYear.get(b.date.slice(0, 4)) ?? 0) + cost);
  }
  for (const [year, cost] of [...costByYear].sort()) rows.push({ type: 'deposit', id: null, date: `${year}-01-02`, qty: null, price: null, amount: String(Math.ceil((cost + 1500) / 1000) * 1000), ccy: base, fx: null });
  rows.push(...buys);
  // Dividends actually paid by the demo provider while the position was held.
  const today = new Date().toISOString().slice(0, 10);
  for (const id of [...new Set(BUYS.map(b => b.id))]) {
    const inst = m.instrument(id);
    for (const d of await m.dividends(id)) {
      if (d.status !== 'paid' || !d.payDate || d.payDate > today) continue;
      const held = BUYS.filter(b => b.id === id && b.date < d.exDate).reduce((s, b) => s.plus(D(b.qty)), D(0));
      if (held.eq(0)) continue;
      const fx = inst.currency === base ? null : await m.fx(inst.currency, base, d.payDate);
      rows.push({ type: 'dividend', id, date: d.payDate, qty: null, price: null, amount: money(held.times(D(d.amount))), ccy: inst.currency, fx });
    }
  }
  const b = [
    stmt(db, 'INSERT INTO profiles (user_id, display_name, base_currency, interests, onboarded, is_demo) VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT(user_id) DO UPDATE SET is_demo = 1, onboarded = 1', userId, 'Guest', base, JSON.stringify(['stock', 'etf'])),
    stmt(db, 'INSERT INTO portfolios (id, user_id, name, kind) VALUES (?, ?, ?, ?)', pid, userId, 'Demo TFSA', 'demo'),
    stmt(db, 'INSERT INTO watchlists (id, user_id, name, position) VALUES (?, ?, ?, 0), (?, ?, ?, 1)', wl, userId, 'Tech I follow', wl2, userId, 'Canada'),
    ...['xnas.aapl', 'xnas.msft', 'xnas.nvda', 'xtse.shop', 'crypto.btc-usd'].map((id, i) => stmt(db, 'INSERT INTO watchlist_items (id, watchlist_id, instrument_id, position) VALUES (?, ?, ?, ?)', newId('wi'), wl, id, i)),
    ...['xtse.td', 'xtse.ry', 'xtse.enb', 'xtse.xeqt'].map((id, i) => stmt(db, 'INSERT INTO watchlist_items (id, watchlist_id, instrument_id, position) VALUES (?, ?, ?, ?)', newId('wi'), wl2, id, i)),
    stmt(db, "INSERT INTO alert_rules (id, user_id, name, scope, watchlist_id, kind, threshold, window_days, basis) VALUES (?, ?, 'Tech pullbacks', 'watchlist', ?, 'below_rolling_high', '8', 30, 'close')", newId('rule'), userId, wl),
    stmt(db, "INSERT INTO plans (id, user_id, name, mode, instrument_id, portfolio_id, schedule, regular_amount, levels, max_total, currency, next_review) VALUES (?, ?, 'XEQT every month', 'hybrid', 'xtse.xeqt', ?, 'monthly', '500', ?, '3000', 'CAD', ?)", newId('plan'), userId, pid, JSON.stringify([{ dropPct: '5', amount: '500' }, { dropPct: '10', amount: '1000' }]), new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)),
  ];
  const occ = new Map<string, number>();
  for (const r of rows) {
    const t = { type: r.type, tradeDate: r.date, instrumentId: r.id, quantity: r.qty, price: r.price, amount: r.amount, currency: r.ccy };
    const k = txHash(t); const n = occ.get(k) ?? 0; occ.set(k, n + 1);
    b.push(stmt(db, 'INSERT INTO transactions (id, user_id, portfolio_id, type, instrument_id, trade_date, quantity, price, amount, currency, fx_to_base, fee, note, dedupe_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('tx'), userId, pid, r.type, r.id, r.date, r.qty, r.price, r.amount, r.ccy, r.fx, r.type === 'buy' ? '4.95' : '0', 'Demo transaction', txHash(t, n)));
  }
  await db.batch(b);
  return { seeded: true, portfolioId: pid };
}

/** Labelled example discussions. Public posting stays closed until reporting, blocking and moderation run. */
export const DEMO_POSTS = [
  { id: 'demo-post-1', author: { name: 'Sample investor A', handle: 'sample_a' }, createdAt: '2026-11-12T15:20:00Z', instrumentIds: ['xnas.aapl'], kind: 'thesis',
    thesis: { idea: 'I add to a long-term position only on pullbacks of 8% or more from the 30-day high.', reasoning: 'I already hold it through two index funds, so I check the combined exposure first.', risks: 'Concentration in large tech; a pullback can keep going.', horizon: '5+ years', sources: ['Company annual report'] }, comments: 3 },
  { id: 'demo-post-2', author: { name: 'Sample investor B', handle: 'sample_b' }, createdAt: '2026-11-10T13:05:00Z', instrumentIds: ['xtse.xeqt', 'xtse.vfv'], kind: 'post',
    body: 'Holding XEQT and VFV together means a lot of my US exposure is doubled up. Portfolio X-Ray made that obvious.', comments: 5 },
  { id: 'demo-post-3', author: { name: 'Sample investor C', handle: 'sample_c' }, createdAt: '2026-11-08T18:40:00Z', instrumentIds: ['xtse.td', 'xtse.ry'], kind: 'post',
    body: 'My rule for Canadian banks: review if one is 10% below its 52-week high, then read the latest results before doing anything.', comments: 2 },
];
