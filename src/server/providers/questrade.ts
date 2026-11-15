// Canadian and US prices through a Questrade customer's own personal API app (free, no daily cap).
// Used only for that customer's requests and alerts. Questrade's refresh tokens are single-use: every
// refresh returns a new one, which is saved straight away (encrypted) through `persist`.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, Instrument, Quote, Statistics } from '../../domain/types';
import { rawFetch, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';
import { US_MICS } from './alpaca';

export const questradeInfo: ProviderInfo = {
  id: 'questrade', name: 'Questrade (your own account)', provenance: 'production', enabled: true, delaySeconds: null,
  assetClasses: ['stock', 'etf'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 60, newsContent: 'none', notes: 'Each Questrade customer connects their own personal API app; their data is shown only to them.' },
};

export interface QuestradeSession { refreshToken: string; accessToken: string | null; apiServer: string | null; expiresAt: number }

const LOGIN = 'https://login.questrade.com/oauth2/token';

/** Redeems a refresh token. Returns the new session (with the rotated refresh token) or 'invalid'. */
export async function redeemQuestrade(refreshToken: string): Promise<QuestradeSession | 'invalid' | 'unavailable'> {
  try {
    const res = await rawFetch(`${LOGIN}?grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`);
    if (res.status === 400 || res.status === 401) return 'invalid';
    if (!res.ok) return 'unavailable';
    const t = await res.json() as { access_token: string; refresh_token: string; api_server: string; expires_in: number };
    if (!t.access_token || !t.refresh_token) return 'invalid';
    return { refreshToken: t.refresh_token, accessToken: t.access_token, apiServer: t.api_server.replace(/\/?$/, '/'), expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  } catch { return 'unavailable'; }
}

/** Questrade's symbol for an instrument: SHOP.TO on the TSX, XYZ.VN on the TSX Venture, plain tickers in the US. */
export function questradeSymbol(inst: Instrument): string | null {
  if (inst.assetClass !== 'stock' && inst.assetClass !== 'etf') return null;
  if (inst.exchange === 'XTSE') return `${inst.symbol}.TO`;
  if (inst.exchange === 'XTSX') return `${inst.symbol}.VN`;
  if (US_MICS.has(inst.exchange)) return inst.symbol;
  return null;
}

interface QSymbol { symbol: string; symbolId: number; prevDayClosePrice: number | null; highPrice52: number | null; lowPrice52: number | null; currency: string }
interface QQuote { symbol: string; symbolId: number; lastTradePrice: number | null; lastTradeTime: string | null; highPrice: number | null; lowPrice: number | null; delay: number }
interface QCandle { start: string; open: number; high: number; low: number; close: number; volume: number }

const memo = new Map<string, { until: number; value: unknown }>();
const remember = async <T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
  const hit = memo.get(key); if (hit && hit.until > Date.now()) return hit.value as T;
  const value = await fn();
  if (memo.size > 3000) memo.clear();
  memo.set(key, { until: Date.now() + ttlMs, value });
  return value;
};
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

export function createQuestrade(userId: string, initial: QuestradeSession, hooks: { persist: (s: QuestradeSession) => Promise<void>; reload: () => Promise<QuestradeSession | null>; onInvalid: () => void }) {
  let session = initial;
  let refreshing: Promise<void> | null = null;
  const ensure = async () => {
    if (session.accessToken && session.apiServer && session.expiresAt > Date.now()) return;
    refreshing ??= (async () => {
      // Another request may have rotated the token already; use theirs before spending ours.
      const latest = await hooks.reload();
      if (latest?.accessToken && latest.expiresAt > Date.now()) { session = latest; return; }
      const next = await redeemQuestrade((latest ?? session).refreshToken);
      if (next === 'invalid') { hooks.onInvalid(); throw new UpstreamError(401, 'Questrade no longer accepts your saved token. Generate a new one in Questrade\'s App Hub and paste it in Settings.'); }
      if (next === 'unavailable') throw new UpstreamError(503, 'Couldn\'t reach Questrade to sign in. Try again in a minute.');
      session = next;
      await hooks.persist(next);
    })().finally(() => { refreshing = null; });
    await refreshing;
  };
  const call = async <T>(path: string, retried = false): Promise<T> => {
    await ensure();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await rawFetch(`${session.apiServer}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 401 && !retried) { session = { ...session, accessToken: null, expiresAt: 0 }; return call<T>(path, true); }
      if (res.status === 429) throw new UpstreamError(429, 'Questrade is limiting requests right now. Try again in a moment.');
      if (!res.ok) throw new UpstreamError(res.status, `Questrade returned ${res.status}.`);
      return await res.json() as T;
    } catch (e) { if (e instanceof UpstreamError) throw e; throw new UpstreamError(504, 'Questrade did not answer in time.'); }
    finally { clearTimeout(t); }
  };

  // Symbol details (ID, previous close, 52-week range) batched by name and cached for an hour.
  let queue: { name: string; resolve: (s: QSymbol | undefined) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = queue; queue = []; timer = null;
    const names = [...new Set(batch.map(b => b.name))];
    try {
      const d = await call<{ symbols: QSymbol[] }>(`v1/symbols?names=${names.map(encodeURIComponent).join(',')}`);
      const by = new Map(d.symbols.map(s => [s.symbol.toUpperCase(), s]));
      for (const b of batch) b.resolve(by.get(b.name.toUpperCase()));
    } catch (e) { for (const b of batch) b.reject(e); }
  };
  const symbol = (name: string) => remember(`${userId}:qs:${name}`, 3600_000, () => new Promise<QSymbol | undefined>((resolve, reject) => {
    queue.push({ name, resolve, reject }); timer ??= setTimeout(() => void flush(), 8);
  }));
  const quoteOf = (id: number) => remember(`${userId}:qq:${id}`, 30_000, async () => (await call<{ quotes: QQuote[] }>(`v1/markets/quotes?ids=${id}`)).quotes[0]);
  const candles = (id: number, tz: string) => remember(`${userId}:qc:${id}`, 6 * 3600_000, async () => {
    const end = new Date().toISOString(); const start = '2021-11-15T00:00:00Z';
    void tz;
    return (await call<{ candles: QCandle[] }>(`v1/markets/candles/${id}?startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}&interval=OneDay`)).candles;
  });
  const need = async (inst: Instrument, name: string) => { const s = await symbol(name); if (!s) throw new UpstreamError(404, `Questrade doesn't list ${inst.symbol}.`); return s; };
  const meta = (observedAt: string | null, delay: number | null, notes: string[]) => ({ provider: 'questrade', provenance: 'production' as const, observedAt, retrievedAt: new Date().toISOString(), delaySeconds: delay, notes });

  return {
    info: questradeInfo,
    async quote(inst: Instrument, name: string, now: Date): Promise<Quote> {
      const s = await need(inst, name);
      const q = await quoteOf(s.symbolId);
      const last = q?.lastTradePrice ?? s.prevDayClosePrice;
      if (last == null) throw new UpstreamError(404, `Questrade has no recent price for ${inst.symbol}.`);
      const p = D(r4(last)), pc = D(r4(s.prevDayClosePrice ?? last));
      const delay = q?.delay ? q.delay * 60 : 0;
      return {
        instrumentId: inst.id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pc.eq(0) ? '0.00' : pct(p.minus(pc).div(pc).times(100)),
        dayHigh: q?.highPrice ? r4(q.highPrice) : null, dayLow: q?.lowPrice ? r4(q.lowPrice) : null, currency: inst.currency, session: sessionStatus(inst.exchange, inst.assetClass, now),
        meta: meta(q?.lastTradeTime ?? null, delay, [delay ? `Delayed about ${delay / 60} minutes via your Questrade account.` : 'Real-time via your Questrade account.', 'Shown only to you.']),
      };
    },
    /** Completed daily sessions. Questrade candles aren't dividend-adjusted, so adjClose equals close. */
    async history(inst: Instrument, name: string, now: Date): Promise<Bar[]> {
      const s = await need(inst, name);
      const rows = await candles(s.symbolId, inst.timezone);
      const { date: today, hour } = localParts(now, inst.timezone);
      return rows.map(c => ({ date: localParts(new Date(c.start), inst.timezone).date, open: r4(c.open), high: r4(c.high), low: r4(c.low), close: r4(c.close), adjClose: r4(c.close), volume: c.volume }))
        .filter(b => b.date < today || hour >= 17);
    },
    statistics(inst: Instrument, bars: Bar[]): Statistics {
      const year = bars.slice(-252);
      return {
        instrumentId: inst.id,
        fiftyTwoWeekHigh: year.length ? r4(Math.max(...year.map(b => Number(b.high)))) : null, fiftyTwoWeekLow: year.length ? r4(Math.min(...year.map(b => Number(b.low)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 252)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.close) }))).pct),
        marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null,
        meta: meta(bars.at(-1) ? `${bars.at(-1)!.date}T21:00:00Z` : null, null, ['Computed from daily prices via your Questrade account (not dividend-adjusted).']),
      };
    },
  };
}
export type Questrade = ReturnType<typeof createQuestrade>;
