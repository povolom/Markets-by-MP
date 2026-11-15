// Real US stock and ETF prices through a user's own free Alpaca account (Market Data API v2).
// Used only for that user's requests and alerts, never shared with anyone else, which keeps within
// Alpaca's personal-use terms. Quotes: IEX real-time last trade. History: daily bars from the
// consolidated tape (SIP), which the free plan allows once data is at least 15 minutes old.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, Instrument, Quote, Statistics } from '../../domain/types';
import { rawFetch, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';
import type { AlpacaCreds } from '../data-keys';

export const US_MICS = new Set(['XNAS', 'XNYS', 'XASE', 'ARCX', 'BATS']);
export const alpacaInfo: ProviderInfo = {
  id: 'alpaca', name: 'Alpaca (your own key)', provenance: 'production', enabled: true, delaySeconds: 0,
  assetClasses: ['stock', 'etf'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 60, newsContent: 'none', notes: 'Each user connects their own free Alpaca key; their data is shown only to them.' },
};

const BASE = 'https://data.alpaca.markets/v2';
interface Snap { latestTrade?: { t: string; p: number }; dailyBar?: { t: string; o: number; h: number; l: number; c: number; v: number }; prevDailyBar?: { t: string; c: number } }
interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }

// Per-user caches, so one person's data never serves another person.
const memo = new Map<string, { until: number; value: unknown }>();
const remember = async <T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
  const hit = memo.get(key); if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await fn();
  if (memo.size > 3000) memo.clear();
  memo.set(key, { until: Date.now() + ttlMs, value });
  return value;
};

const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);
const nyDate = (iso: string) => localParts(new Date(iso), 'America/New_York').date;

export async function verifyAlpaca(creds: AlpacaCreds): Promise<'ok' | 'invalid' | 'unavailable'> {
  try {
    const res = await rawFetch(`${BASE}/stocks/snapshots?symbols=AAPL&feed=iex`, { headers: { 'APCA-API-KEY-ID': creds.keyId, 'APCA-API-SECRET-KEY': creds.secret } });
    if (res.status === 401 || res.status === 403) return 'invalid';
    return res.ok ? 'ok' : 'unavailable';
  } catch { return 'unavailable'; }
}

export function createAlpaca(creds: AlpacaCreds, onInvalid?: () => void) {
  const who = creds.keyId;
  const call = async <T>(path: string): Promise<T> => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await rawFetch(`${BASE}${path}`, { headers: { 'APCA-API-KEY-ID': creds.keyId, 'APCA-API-SECRET-KEY': creds.secret, accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 401) { onInvalid?.(); throw new UpstreamError(401, 'Your Alpaca key was rejected. Reconnect it in Settings.'); }
      if (!res.ok) throw new UpstreamError(res.status, `Alpaca returned ${res.status}.`);
      return await res.json() as T;
    } catch (e) { if (e instanceof UpstreamError) throw e; throw new UpstreamError(504, 'Alpaca did not answer in time.'); }
    finally { clearTimeout(t); }
  };

  // Quotes are batched: calls made within a few milliseconds share one snapshots request.
  let queue: { sym: string; resolve: (s: Snap | undefined) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = queue; queue = []; timer = null;
    const syms = [...new Set(batch.map(b => b.sym))];
    for (let i = 0; i < syms.length; i += 100) {
      const part = syms.slice(i, i + 100);
      try {
        const data = await call<Record<string, Snap>>(`/stocks/snapshots?symbols=${part.map(encodeURIComponent).join(',')}&feed=iex`);
        for (const b of batch) if (part.includes(b.sym)) b.resolve(data[b.sym]);
      } catch (e) { for (const b of batch) if (part.includes(b.sym)) b.reject(e); }
    }
  };
  const snapshot = (sym: string) => remember(`${who}:snap:${sym}`, 15_000, () => new Promise<Snap | undefined>((resolve, reject) => {
    queue.push({ sym, resolve, reject });
    timer ??= setTimeout(() => void flush(), 8);
  }));

  const bars = (sym: string, adjustment: 'all' | 'split') => remember(`${who}:bars:${sym}:${adjustment}`, 3 * 3600_000, async () => {
    const end = new Date(Date.now() - 16 * 60_000).toISOString();
    const out: RawBar[] = []; let token = '';
    for (let page = 0; page < 5; page++) {
      const q = `/stocks/bars?symbols=${encodeURIComponent(sym)}&timeframe=1Day&start=2021-11-15T00:00:00Z&end=${end}&adjustment=${adjustment}&feed=sip&limit=10000${token ? `&page_token=${token}` : ''}`;
      const d = await call<{ bars: Record<string, RawBar[]> | null; next_page_token: string | null }>(q);
      out.push(...(d.bars?.[sym] ?? []));
      if (!d.next_page_token) break; token = d.next_page_token;
    }
    return out;
  });

  return {
    info: alpacaInfo,
    async quote(inst: Instrument, now: Date): Promise<Quote> {
      const s = await snapshot(inst.symbol);
      if (!s?.latestTrade) throw new UpstreamError(404, `Alpaca has no recent trades for ${inst.symbol}.`);
      const tradeDay = nyDate(s.latestTrade.t);
      const sameDay = s.dailyBar && nyDate(s.dailyBar.t) === tradeDay;
      const prevClose = sameDay ? s.prevDailyBar?.c : s.dailyBar?.c;
      const p = D(r4(s.latestTrade.p)), pc = D(r4(prevClose ?? s.latestTrade.p));
      return {
        instrumentId: inst.id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pc.eq(0) ? '0.00' : pct(p.minus(pc).div(pc).times(100)),
        dayHigh: sameDay ? r4(s.dailyBar!.h) : null, dayLow: sameDay ? r4(s.dailyBar!.l) : null, currency: 'USD', session: sessionStatus(inst.exchange, inst.assetClass, now),
        meta: { provider: 'alpaca', provenance: 'production', observedAt: s.latestTrade.t, retrievedAt: new Date().toISOString(), delaySeconds: 0, notes: ['Real-time IEX last trade via your Alpaca account. Shown only to you.'] },
      };
    },
    /** Completed daily sessions. close is split-adjusted; adjClose also adjusts for dividends. */
    async history(inst: Instrument, now: Date): Promise<Bar[]> {
      const [split, all] = await Promise.all([bars(inst.symbol, 'split'), bars(inst.symbol, 'all')]);
      const adj = new Map(all.map(b => [nyDate(b.t), b.c]));
      const { date: today, hour } = localParts(now, 'America/New_York');
      return split.map(b => ({ date: nyDate(b.t), open: r4(b.o), high: r4(b.h), low: r4(b.l), close: r4(b.c), adjClose: r4(adj.get(nyDate(b.t)) ?? b.c), volume: b.v }))
        .filter(b => b.date < today || hour >= 16);
    },
    async statistics(inst: Instrument, bars: Bar[], observedAt: string | null): Promise<Statistics> {
      const year = bars.slice(-252);
      return {
        instrumentId: inst.id,
        fiftyTwoWeekHigh: year.length ? r4(Math.max(...year.map(b => Number(b.high)))) : null, fiftyTwoWeekLow: year.length ? r4(Math.min(...year.map(b => Number(b.low)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 252)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.adjClose) }))).pct),
        marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null,
        meta: { provider: 'alpaca', provenance: 'production', observedAt, retrievedAt: new Date().toISOString(), delaySeconds: 0, notes: ['Computed from daily bars via your Alpaca account.'] },
      };
    },
  };
}
export type Alpaca = ReturnType<typeof createAlpaca>;
