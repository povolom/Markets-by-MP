// One personal key for every exchange: EODHD (eodhd.com). Used only for the user who connected it, which
// keeps within EODHD's personal-use terms. Quotes are 15-20 minutes delayed on most exchanges; history is
// daily with raw and adjusted closes; dividends are the company's actual payments.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, DividendRecord, Instrument, Quote, Statistics } from '../../domain/types';
import { rawFetch, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';

export const eodhdInfo: ProviderInfo = {
  id: 'eodhd', name: 'EODHD (your own key)', provenance: 'production', enabled: true, delaySeconds: 900,
  assetClasses: ['stock', 'etf', 'index'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 300, newsContent: 'none', notes: 'Each user connects their own EODHD key; their data is shown only to them.' },
};

const BASE = 'https://eodhd.com/api';
const SUFFIX: Record<string, string> = { XNAS: 'US', XNYS: 'US', XASE: 'US', ARCX: 'US', BATS: 'US', XTSE: 'TO', XTSX: 'V' };
const INDEX: Record<string, string> = { 'index.spx': 'GSPC.INDX', 'index.ixic': 'IXIC.INDX', 'index.tsx': 'GSPTSE.INDX', 'index.dji': 'DJI.INDX' };

/** EODHD ticker for an instrument, or null if EODHD doesn't serve it through Markets. */
export function eodhdTicker(inst: Instrument): string | null {
  if (inst.assetClass === 'index') return INDEX[inst.id] ?? null;
  if (inst.assetClass !== 'stock' && inst.assetClass !== 'etf') return null;
  const sfx = SUFFIX[inst.exchange]; if (!sfx) return null;
  return `${inst.symbol.replace(/\./g, '-')}.${sfx}`;
}

interface RT { code: string; timestamp: number | 'NA'; open: number | 'NA'; high: number | 'NA'; low: number | 'NA'; close: number | 'NA'; previousClose: number | 'NA'; change_p: number | 'NA' }
interface EodRow { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number }

const memo = new Map<string, { until: number; value: unknown }>();
const remember = async <T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
  const hit = memo.get(key); if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await fn();
  if (memo.size > 3000) memo.clear();
  memo.set(key, { until: Date.now() + ttlMs, value });
  return value;
};
const num = (v: number | 'NA' | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** Checks a token and reads its plan. Doesn't use up a call on most plans. */
export async function verifyEodhd(token: string): Promise<{ status: 'ok' | 'invalid' | 'unavailable'; plan?: string; dailyLimit?: number | null }> {
  try {
    const res = await rawFetch(`${BASE}/user?api_token=${encodeURIComponent(token)}&fmt=json`);
    if (res.status === 401 || res.status === 403) return { status: 'invalid' };
    if (!res.ok) return { status: 'unavailable' };
    const u = await res.json() as { subscriptionType?: string; dailyRateLimit?: number };
    return { status: 'ok', plan: u.subscriptionType ?? undefined, dailyLimit: typeof u.dailyRateLimit === 'number' ? u.dailyRateLimit : null };
  } catch { return { status: 'unavailable' }; }
}

export function createEodhd(token: string, onInvalid?: () => void) {
  const who = token.slice(-8);
  const call = async <T>(path: string): Promise<T> => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await rawFetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}&fmt=json`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (res.status === 401) { onInvalid?.(); throw new UpstreamError(401, 'EODHD rejected your key. Reconnect it in Settings.'); }
      if (res.status === 402 || res.status === 429) throw new UpstreamError(429, 'Your EODHD key has used up its calls for today. It resets daily; a paid EODHD plan raises the limit.');
      if (res.status === 403) throw new UpstreamError(403, 'Your EODHD plan doesn\'t include this exchange or data.');
      if (!res.ok) throw new UpstreamError(res.status, `EODHD returned ${res.status}.`);
      return await res.json() as T;
    } catch (e) { if (e instanceof UpstreamError) throw e; throw new UpstreamError(504, 'EODHD did not answer in time.'); }
    finally { clearTimeout(t); }
  };

  // Quotes are batched into one request; each ticker still counts as one call on EODHD's side.
  let queue: { tk: string; resolve: (r: RT | undefined) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = queue; queue = []; timer = null;
    const tks = [...new Set(batch.map(b => b.tk))];
    for (let i = 0; i < tks.length; i += 20) {
      const part = tks.slice(i, i + 20);
      try {
        const data = await call<RT | RT[]>(`/real-time/${encodeURIComponent(part[0])}${part.length > 1 ? `?s=${part.slice(1).map(encodeURIComponent).join(',')}` : ''}`);
        const list = Array.isArray(data) ? data : [data];
        const by = new Map(list.map(r => [r.code, r]));
        for (const b of batch) if (part.includes(b.tk)) b.resolve(by.get(b.tk));
      } catch (e) { for (const b of batch) if (part.includes(b.tk)) b.reject(e); }
    }
  };
  // Delayed data barely changes faster than this, and it keeps free and small plans within their limits.
  const realtime = (tk: string) => remember(`${who}:rt:${tk}`, 5 * 60_000, () => new Promise<RT | undefined>((resolve, reject) => {
    queue.push({ tk, resolve, reject });
    timer ??= setTimeout(() => void flush(), 8);
  }));
  const eod = (tk: string) => remember(`${who}:eod:${tk}`, 12 * 3600_000, () => call<EodRow[]>(`/eod/${encodeURIComponent(tk)}?from=2021-11-15&period=d`));
  const meta = (observedAt: string | null, notes: string[]) => ({ provider: 'eodhd', provenance: 'production' as const, observedAt, retrievedAt: new Date().toISOString(), delaySeconds: 900, notes });

  return {
    info: eodhdInfo,
    async quote(inst: Instrument, tk: string, now: Date): Promise<Quote> {
      const r = await realtime(tk);
      const close = num(r?.close), prev = num(r?.previousClose);
      if (close == null) throw new UpstreamError(404, `EODHD has no recent price for ${inst.symbol}.`);
      const p = D(r4(close)), pc = D(r4(prev ?? close));
      const ts = num(r?.timestamp);
      return {
        instrumentId: inst.id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pc.eq(0) ? '0.00' : pct(p.minus(pc).div(pc).times(100)),
        dayHigh: num(r?.high) == null ? null : r4(num(r?.high)!), dayLow: num(r?.low) == null ? null : r4(num(r?.low)!), currency: inst.currency, session: sessionStatus(inst.exchange, inst.assetClass, now),
        meta: meta(ts ? new Date(ts * 1000).toISOString() : null, ['Delayed price (usually 15-20 minutes) via your EODHD key. Shown only to you.']),
      };
    },
    /** Completed daily sessions: close is the raw price, adjClose adjusts for splits and dividends. */
    async history(inst: Instrument, tk: string, now: Date): Promise<Bar[]> {
      const rows = await eod(tk);
      const { date: today, hour } = localParts(now, inst.timezone);
      return rows.filter(b => b.date < today || hour >= 17).map(b => ({ date: b.date, open: r4(b.open), high: r4(b.high), low: r4(b.low), close: r4(b.close), adjClose: r4(b.adjusted_close), volume: inst.assetClass === 'index' ? null : b.volume }));
    },
    async dividends(inst: Instrument, tk: string, now: Date): Promise<DividendRecord[]> {
      if (inst.assetClass === 'index') return [];
      const rows = await remember(`${who}:div:${tk}`, 24 * 3600_000, () => call<{ date: string; paymentDate: string | null; value: number; currency: string }[]>(`/div/${encodeURIComponent(tk)}?from=2021-11-15`));
      const today = localParts(now, 'UTC').date;
      return rows.map(d => ({ exDate: d.date, payDate: d.paymentDate, amount: r4(d.value), currency: d.currency || inst.currency, status: (d.paymentDate && d.paymentDate <= today ? 'paid' : 'declared') as DividendRecord['status'] }));
    },
    statistics(inst: Instrument, bars: Bar[]): Statistics {
      const year = bars.slice(-252);
      return {
        instrumentId: inst.id,
        fiftyTwoWeekHigh: year.length ? r4(Math.max(...year.map(b => Number(b.high)))) : null, fiftyTwoWeekLow: year.length ? r4(Math.min(...year.map(b => Number(b.low)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 252)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.adjClose) }))).pct),
        marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null,
        meta: meta(bars.at(-1) ? `${bars.at(-1)!.date}T21:00:00Z` : null, ['Computed from daily prices via your EODHD key.']),
      };
    },
  };
}
export type Eodhd = ReturnType<typeof createEodhd>;
