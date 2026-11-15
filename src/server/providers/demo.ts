// Deterministic demo provider. The same instrument and date always produce the same numbers, so the
// demo is reproducible, testable and internally consistent: quotes come from the history, statistics
// are computed from it, dividends are a stated yield of the price, and splits and dividends are
// reflected in the adjusted close exactly as they would be for real data.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { exchangeTimezone, localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, DividendRecord, Financials, Instrument, MarketEvent, NewsItem, Quote, Statistics } from '../../domain/types';
import { fnv1a } from '../../domain/csv';
import { COMPOSITIONS, SEEDS } from './demo-catalogue';
import { INSTRUMENTS } from './universe';
import type { MarketDataProvider, ProviderInfo } from './types';

// Seed prices are defined at ORIGIN; paths are generated from START (shorter history = less CPU per request on
// Cloudflare's free plan, which allows about 10 ms). The demo portfolio's first trade is in January 2024.
const ORIGIN = '2021-11-15';
const START = '2023-11-15';
type Seed = (typeof SEEDS)[number];
const seeds = new Map<string, Seed>(SEEDS.map(s => [s.id, s]));
const instruments = INSTRUMENTS;
const byId = new Map(instruments.map(i => [i.id, i]));

/** FNV-1a 32-bit over UTF-16 code units: fast and deterministic (seeding only, not for security). */
function hash32(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(key: string) {
  let a = hash32(key);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (key: string) => { const r = rng(key); const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);
const r4f = (n: number) => (Math.round(n * 1e4) / 1e4).toFixed(4);

/** Listings outside the curated catalogue get a plain, deterministic demo profile: a price level, drift and
 * volatility derived from the ID, with no dividends, splits or financial statements. */
function seedOf(id: string): Seed {
  const hit = seeds.get(id); if (hit) return hit;
  const inst = byId.get(id)!; const h = hash32(id);
  const u = (h % 10007) / 10007, v = ((h >>> 12) % 1009) / 1009;
  const [lo, hi, vol] = inst.assetClass === 'crypto' ? [0.05, 80, 0.85 + v * 0.3] : inst.assetClass === 'fx' ? [0.6, 1.6, 0.07] : inst.assetClass === 'etf' ? [15, 120, 0.13 + v * 0.1] : [6, 220, 0.24 + v * 0.3];
  const s: Seed = { id, symbol: inst.symbol, name: inst.name, cls: inst.assetClass, ex: inst.exchange, exName: inst.exchangeName, ccy: inst.currency, country: inst.country, sector: inst.sector, industry: inst.industry,
    start: Math.round(Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo))) * 100) / 100, drift: inst.assetClass === 'fx' ? 0 : 0.03 + v * 0.08, vol, desc: inst.description };
  if (seeds.size > 5000) for (const k of [...seeds.keys()].slice(SEEDS.length, SEEDS.length + 1000)) seeds.delete(k);
  seeds.set(id, s);
  return s;
}

/** Every calendar date from START to `to`, computed once and shared by all instruments. */
let calendar: { date: string; weekday: number }[] = [];
function calendarTo(to: string) {
  if (!calendar.length || calendar[calendar.length - 1].date < to) {
    calendar = [];
    const t0 = Date.parse(START + 'T00:00:00Z'), t1 = Date.parse(to + 'T00:00:00Z');
    for (let t = t0; t <= t1; t += 86400000) { const d = new Date(t); calendar.push({ date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() }); }
  }
  return calendar;
}

/** The last date whose session has fully closed, in the exchange's timezone. */
function completedThrough(inst: Instrument, now: Date): string {
  const tz = exchangeTimezone(inst.exchange, inst.assetClass);
  const local = localParts(now, tz);
  let d = local.date;
  const closedToday = inst.assetClass === 'crypto' ? false : (sessionStatus(inst.exchange, inst.assetClass, now) === 'closed' && local.hour >= 16);
  if (!closedToday) d = addDays(d, -1);
  if (inst.assetClass !== 'crypto') while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

interface Series { bars: Bar[]; divs: { exDate: string; payDate: string; amount: number }[]; todayBar: Bar | null }
const cache = new Map<string, Series>();

function generate(id: string, now: Date): Series {
  const inst = byId.get(id)!; const s = seedOf(id);
  const through = completedThrough(inst, now);
  const key = `${id}:${through}:${localParts(now, 'UTC').date}`;
  const hit = cache.get(key); if (hit) return hit;
  const crypto = inst.assetClass === 'crypto';
  const ppy = crypto ? 365 : 252;
  const mu = s.drift / ppy, sig = s.vol / Math.sqrt(ppy);
  const today = localParts(now, exchangeTimezone(inst.exchange, inst.assetClass)).date;
  const dates: string[] = [];
  for (const c of calendarTo(today)) { if (c.date > today) break; if (crypto || (c.weekday !== 0 && c.weekday !== 6)) dates.push(c.date); }
  // Economic (total-return) path.
  // `start` is the raw price on START; before a split that is ratio x the split-adjusted price.
  const base = s.split && ORIGIN < s.split.date ? s.start / s.split.ratio : s.start;
  const adj0 = base * Math.exp(s.drift * (Date.parse(START) - Date.parse(ORIGIN)) / (365.25 * 86400000));
  const adj: number[] = []; let p = adj0;
  for (const d of dates) { p *= Math.exp(mu - sig * sig / 2 + sig * normal(`${id}:${d}`)); adj.push(p); }
  const ANCHOR = '2026-10-01';
  const ai = dates.findIndex(d => d >= ANCHOR);
  // Pin both ends (a Brownian bridge): the path starts at its start price and passes through its trend
  // level on a fixed anchor date. The tilt is spread evenly over the days, so day-to-day moves keep
  // their shape and the history stays plausible.
  if (ai > 0) {
    const years = (Date.parse(ANCHOR) - Date.parse(START)) / (365.25 * 86400000);
    const c = Math.log(adj0 * Math.exp(s.drift * years) / adj[ai]);
    for (let i = 0; i < adj.length; i++) adj[i] *= Math.exp(c * Math.min(i, ai) / ai);
  }
  // Dividends: a fixed share of the price per payment, on ex-dates near the 15th of each pay month.
  const perPay = s.yieldPct && s.payMonths ? s.yieldPct / 100 / s.payMonths.length : 0;
  const exDates = new Set<string>();
  if (perPay) { const months = new Set<string>(); for (const d of dates) { const ym = d.slice(0, 7); if (months.has(ym)) continue; const m = +d.slice(5, 7), day = +d.slice(8, 10); if (s.payMonths!.includes(m) && day >= 15) { exDates.add(d); months.add(ym); } } }
  // Raw close = adjusted path / (product of (1 - perPay) for later ex-dates) x split ratio before the split.
  const bars: Bar[] = []; const divs: Series['divs'] = [];
  let laterFactor = 1; const factors: number[] = new Array(dates.length);
  for (let i = dates.length - 1; i >= 0; i--) { factors[i] = laterFactor; if (exDates.has(dates[i])) laterFactor *= 1 - perPay; }
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const split = s.split && d < s.split.date ? s.split.ratio : 1;
    const close = adj[i] / factors[i] * split;
    const prevClose = i ? adj[i - 1] / factors[i - 1] * (s.split && dates[i - 1] < s.split.date ? s.split.ratio : 1) : close;
    const r = rng(`${id}:${d}:ohlc`);
    const open = (i && s.split && dates[i - 1] < s.split.date && d >= s.split.date ? prevClose / s.split.ratio : prevClose) * (1 + (r() - 0.5) * sig * 0.6);
    const high = Math.max(open, close) * (1 + r() * sig * 0.5), low = Math.min(open, close) * (1 - r() * sig * 0.5);
    const adjClose = close * factors[i] / split;
    if (exDates.has(d) && i) divs.push({ exDate: d, payDate: addDays(d, 14), amount: prevClose * perPay });
    bars.push({ date: d, open: r4(open), high: r4(high), low: r4(low), close: r4(close), adjClose: r4(adjClose), volume: inst.assetClass === 'index' || inst.assetClass === 'fx' ? null : Math.round(1e6 * (1 + 4 * r()) * (s.marketCapB ? Math.sqrt(s.marketCapB) / 10 : 1)) });
  }
  const completed = bars.filter(b => b.date <= through);
  const todayBar = bars.find(b => b.date > through) ?? null;
  const out = { bars: completed, divs, todayBar };
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

const meta = (observedAt: string | null, notes?: string[]) => ({ provider: 'demo', provenance: 'demo' as const, observedAt, retrievedAt: new Date().toISOString(), delaySeconds: 0, notes: ['Demo data generated by Markets. Not real market prices.', ...(notes ?? [])] });

export const demoInfo: ProviderInfo = {
  id: 'demo', name: 'Markets demo data', provenance: 'demo', enabled: true, delaySeconds: 0,
  assetClasses: ['stock', 'etf', 'mutual_fund', 'crypto', 'index', 'fx'],
  rights: { internalProcessing: true, publicDisplay: true, apiRedistribution: true, derivedAnalytics: true, cachingSeconds: 86400, newsContent: 'headlines_and_excerpts', notes: 'Generated by Markets; free to display and redistribute, but it is not real data.' },
};

export function createDemoProvider(): MarketDataProvider {
  return {
    info: demoInfo,
    instruments: () => instruments,
    instrument: id => byId.get(id),
    async history(id) { return generate(id, new Date()).bars; },
    async quote(id, now) {
      const inst = byId.get(id)!; const { bars, todayBar } = generate(id, now);
      const session = sessionStatus(inst.exchange, inst.assetClass, now);
      const live = Boolean(todayBar && (session === 'open' || session === 'always_open' || session === 'post'));
      // Outside a live session the quote is the last completed session, compared with the one before it.
      const lastBar = bars[bars.length - 1];
      const prev = live ? lastBar : bars[bars.length - 2] ?? lastBar;
      let price = Number(lastBar.close), hi: number | null = live ? null : Number(lastBar.high), lo: number | null = live ? null : Number(lastBar.low), observed = `${lastBar.date}T21:00:00Z`;
      if (live && todayBar) {
        const tz = exchangeTimezone(inst.exchange, inst.assetClass);
        const { hour, minute } = localParts(now, tz);
        const frac = inst.assetClass === 'crypto' ? (hour * 60 + minute) / 1440 : session === 'post' ? 1 : Math.min(1, Math.max(0, (hour * 60 + minute - 570) / 390));
        const o = Number(todayBar.open), c = Number(todayBar.close);
        price = o + (c - o) * frac; hi = Math.max(o, price, Number(todayBar.high) * frac + Math.max(o, price) * (1 - frac)); lo = Math.min(o, price, Number(todayBar.low) * frac + Math.min(o, price) * (1 - frac));
        observed = now.toISOString();
      }
      const pc = D(prev.close), pr = D(r4(price));
      return { instrumentId: id, price: fmtPrice(pr), previousClose: fmtPrice(pc), change: fmtPrice(pr.minus(pc)), changePct: pct(pr.minus(pc).div(pc).times(100)), dayHigh: hi == null ? null : r4(hi), dayLow: lo == null ? null : r4(lo), currency: inst.currency, session, meta: meta(observed) } satisfies Quote;
    },
    async dividends(id, now) {
      const s = seedOf(id); const { bars, divs } = generate(id, now);
      if (!s.yieldPct || !s.payMonths) return [];
      const today = localParts(now, 'UTC').date;
      const last = Number(bars[bars.length - 1].close), perPay = s.yieldPct / 100 / s.payMonths.length;
      const out: DividendRecord[] = divs.map(d => ({ exDate: d.exDate, payDate: d.payDate, amount: r4(d.amount), currency: byId.get(id)!.currency, status: (d.payDate <= today ? 'paid' : 'declared') as DividendRecord['status'] }));
      // Upcoming: the next ex-date within 30 days is "declared"; later ones are projections.
      for (let k = 0, m = new Date(today + 'T00:00:00Z'); k < 13; k++, m.setUTCMonth(m.getUTCMonth() + 1)) {
        const month = m.getUTCMonth() + 1; if (!s.payMonths.includes(month)) continue;
        let ex = `${m.getUTCFullYear()}-${String(month).padStart(2, '0')}-15`; while (weekday(ex) === 0 || weekday(ex) === 6) ex = addDays(ex, 1);
        if (ex <= (bars[bars.length - 1]?.date ?? today) || out.some(o => o.exDate === ex)) continue;
        const days = (Date.parse(ex) - Date.parse(today)) / 86400000;
        out.push({ exDate: ex, payDate: addDays(ex, 14), amount: r4(last * perPay), currency: byId.get(id)!.currency, status: days <= 30 ? 'declared' : 'projected' });
      }
      return out.sort((a, b) => a.exDate.localeCompare(b.exDate));
    },
    async events(id, now) {
      const inst = byId.get(id)!; const today = localParts(now, 'UTC').date;
      const ev: MarketEvent[] = [];
      if (inst.assetClass === 'stock') {
        const off = hash32(id) % 10;
        for (let y = Number(today.slice(0, 4)) - 1; y <= Number(today.slice(0, 4)) + 1; y++) for (const m of [1, 4, 7, 10]) {
          let d = `${y}-${String(m).padStart(2, '0')}-${String(20 + off).padStart(2, '0')}`; while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
          const days = (Date.parse(d) - Date.parse(today)) / 86400000;
          if (days < -200 || days > 200) continue;
          ev.push({ id: `${id}:earn:${d}`, instrumentId: id, type: 'earnings', date: d, confirmed: days < 0 || days <= 21, title: `${inst.symbol} quarterly results${days > 21 ? ' (estimated date)' : ''}` });
        }
      }
      for (const d of await this.dividends(id, now)) {
        if (Math.abs(Date.parse(d.exDate) - Date.parse(today)) > 200 * 86400000) continue;
        ev.push({ id: `${id}:ex:${d.exDate}`, instrumentId: id, type: 'dividend_ex', date: d.exDate, confirmed: d.status !== 'projected', title: `${inst.symbol} ex-dividend${d.status === 'projected' ? ' (projected)' : ''}` });
        if (d.payDate) ev.push({ id: `${id}:pay:${d.payDate}`, instrumentId: id, type: 'dividend_pay', date: d.payDate, confirmed: d.status !== 'projected', title: `${inst.symbol} dividend payment${d.status === 'projected' ? ' (projected)' : ''}` });
      }
      const s = seedOf(id);
      if (s.split) ev.push({ id: `${id}:split`, instrumentId: id, type: 'split', date: s.split.date, confirmed: true, title: `${inst.symbol} ${s.split.ratio}-for-1 split` });
      return ev.sort((a, b) => a.date.localeCompare(b.date));
    },
    async news(id, now) {
      const today = localParts(now, 'UTC').date;
      const list = id ? [byId.get(id)!] : instruments.filter(i => i.assetClass === 'index' || i.id === 'fx.usdcad');
      const out: NewsItem[] = [];
      for (const inst of list) {
        const r = rng(`${inst.id}:news:${today.slice(0, 7)}`);
        const templates = inst.assetClass === 'stock'
          ? [`${inst.name} sets date for quarterly results`, `What to watch in ${inst.sector?.toLowerCase() ?? 'the sector'} this quarter`, `${inst.symbol} annual meeting: shareholder proposals published`]
          : inst.assetClass === 'etf' || inst.assetClass === 'mutual_fund' ? [`${inst.symbol} publishes updated holdings`, `How index funds rebalance, explained`] : inst.assetClass === 'crypto' ? [`${inst.name} network activity update`, 'Crypto market structure: a primer'] : [`${inst.name}: weekly recap`, 'Central bank calendar for the month ahead'];
        templates.forEach((t, k) => {
          const daysAgo = Math.floor(r() * 9) + k * 3;
          out.push({ id: fnv1a(`${inst.id}:${t}:${today.slice(0, 7)}`), title: t, publisher: 'Markets demo desk', publishedAt: new Date(now.getTime() - daysAgo * 86400000 - Math.floor(r() * 36e6)).toISOString(), url: `/assets/${inst.id}`, excerpt: 'Demo headline written for the Markets demo. It is not a real article and says nothing about why a price moved.', instrumentIds: [inst.id], kind: k === 1 ? 'opinion' : 'reporting', provenance: 'demo' });
        });
      }
      return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    },
    async statistics(id, now) {
      const inst = byId.get(id)!; const s = seedOf(id); const { bars } = generate(id, now);
      const year = bars.slice(-(inst.assetClass === 'crypto' ? 365 : 252));
      const closes = year.map(b => Number(b.close)), last = closes[closes.length - 1];
      const equity = inst.assetClass === 'stock', fund = inst.assetClass === 'etf' || inst.assetClass === 'mutual_fund';
      const dd = maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.adjClose) })));
      return {
        instrumentId: id,
        fiftyTwoWeekHigh: r4(Math.max(...year.map(b => Number(b.high)))), fiftyTwoWeekLow: r4(Math.min(...year.map(b => Number(b.low)))),
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), inst.assetClass === 'crypto' ? 365 : 252)),
        maxDrawdown1y: fmtPct(dd.pct),
        marketCap: equity && s.marketCapB ? String(Math.round(s.marketCapB * 1e9 * (last / Number(year[0].close)) ** 0.2)) : null,
        peRatio: equity && s.pe ? (s.pe * (0.9 + rng(`${id}:pe:${bars.at(-1)!.date}`)() * 0.2)).toFixed(2) : null,
        dividendYield: (equity || fund) && s.yieldPct ? s.yieldPct.toFixed(2) : (equity || fund) ? '0.00' : null,
        expenseRatio: fund && s.expense != null ? s.expense.toFixed(2) : null,
        beta: equity ? (0.6 + s.vol * 1.5).toFixed(2) : null,
        meta: meta(`${bars.at(-1)!.date}T21:00:00Z`),
      } satisfies Statistics;
    },
    async financials(id, now) {
      const inst = byId.get(id)!; const s = seedOf(id);
      if (inst.assetClass !== 'stock' || !s.revenueB) return null;
      const y = Number(localParts(now, 'UTC').date.slice(0, 4)) - 1;
      const periods = [0, 1, 2, 3].map(k => `FY${y - k}`);
      const r = rng(`${id}:fin`); const growth = 0.04 + r() * 0.12, margin = 0.08 + r() * 0.22;
      const rev = periods.map((_, k) => s.revenueB! * 1e9 / (1 + growth) ** k);
      const fmt = (v: number) => String(Math.round(v));
      const row = (label: string, f: (rv: number, k: number) => number) => ({ label, values: rev.map((rv, k) => fmt(f(rv, k))) });
      return {
        instrumentId: id, periods, currency: inst.currency,
        income: [row('Revenue', rv => rv), row('Gross profit', rv => rv * (margin + 0.3)), row('Operating income', rv => rv * (margin + 0.05)), row('Net income', rv => rv * margin)],
        balance: [row('Total assets', rv => rv * 1.6), row('Total liabilities', rv => rv * 0.9), row('Cash and equivalents', rv => rv * 0.15)],
        cashflow: [row('Operating cash flow', rv => rv * (margin + 0.06)), row('Capital expenditure', rv => -rv * 0.05), row('Free cash flow', rv => rv * (margin + 0.01))],
        meta: meta(null, ['Demo financial statements. Not real company results.']),
      } satisfies Financials;
    },
    composition: id => COMPOSITIONS[id],
    async fxRate(from, to, date) {
      if (from === to) return '1';
      const pair = (a: string, b: string) => byId.get(`fx.${a.toLowerCase()}${b.toLowerCase()}`);
      const at = async (inst: Instrument) => {
        if (!date) return Number((await this.quote(inst.id, new Date())).price);
        const bars = generate(inst.id, new Date()).bars; let v = bars[0];
        for (const b of bars) { if (b.date > date) break; v = b; }
        return Number(v.close);
      };
      const direct = pair(from, to); if (direct) return r4(await at(direct));
      const inverse = pair(to, from); if (inverse) return (1 / await at(inverse)).toFixed(6);
      if (from !== 'USD' && to !== 'USD') return (Number(await this.fxRate(from, 'USD', date)) * Number(await this.fxRate('USD', to, date))).toFixed(6);
      throw new Error(`No FX rate for ${from}/${to}`);
    },
  };
}
