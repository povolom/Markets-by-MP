// Alpha Vantage with a user's own free key: TSX, TSX Venture and US daily prices. The free plan allows about
// 25 calls a day, so Markets spends one call per stock per day: a single daily-series request gives both the
// history and the latest close, cached at the edge (keyed to that user's key) until the next session.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, Instrument, Quote, Statistics } from '../../domain/types';
import { rawFetch, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';
import { US_MICS } from './alpaca';

export const alphaVantageInfo: ProviderInfo = {
  id: 'alphavantage', name: 'Alpha Vantage (your own key)', provenance: 'production', enabled: true, delaySeconds: 86400,
  assetClasses: ['stock', 'etf'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 21600, newsContent: 'none', notes: 'Each user connects their own Alpha Vantage key; their data is shown only to them.' },
};

const BASE = 'https://www.alphavantage.co/query';

export function alphaVantageSymbol(inst: Instrument): string | null {
  if (inst.assetClass !== 'stock' && inst.assetClass !== 'etf') return null;
  if (inst.exchange === 'XTSE') return `${inst.symbol.replace(/\./g, '-')}.TRT`;
  if (inst.exchange === 'XTSX') return `${inst.symbol.replace(/\./g, '-')}.TRV`;
  if (US_MICS.has(inst.exchange)) return inst.symbol.replace(/\./g, '-');
  return null;
}

type Series = Record<string, { '1. open': string; '2. high': string; '3. low': string; '4. close': string; '5. volume': string }>;
interface AvResponse { 'Time Series (Daily)'?: Series; Information?: string; Note?: string; 'Error Message'?: string }

const memo = new Map<string, { until: number; value: Bar[] }>();
async function hashKey(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

function classify(body: AvResponse): UpstreamError | null {
  const msg = body.Information ?? body.Note ?? body['Error Message'];
  if (body['Time Series (Daily)']) return null;
  if (!msg) return new UpstreamError(502, 'Alpha Vantage returned no prices.');
  if (/rate limit|requests per day|per minute/i.test(msg)) return new UpstreamError(429, 'Your Alpha Vantage key has used its free calls for today (about 25 a day). Markets saves calls by fetching each stock once a day; it resets tomorrow.');
  if (/apikey|api key/i.test(msg)) return new UpstreamError(401, 'Alpha Vantage rejected your key. Reconnect it in Settings.');
  if (/invalid api call/i.test(msg)) return new UpstreamError(404, 'Alpha Vantage doesn\'t have this listing.');
  return new UpstreamError(502, 'Alpha Vantage couldn\'t return prices right now.');
}

/** One call to confirm the key works (it counts toward the day's limit). */
export async function verifyAlphaVantage(apiKey: string): Promise<'ok' | 'invalid' | 'limited' | 'unavailable'> {
  try {
    const res = await rawFetch(`${BASE}?function=GLOBAL_QUOTE&symbol=SHOP.TRT&apikey=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return 'unavailable';
    const body = await res.json() as { 'Global Quote'?: unknown } & AvResponse;
    if (body['Global Quote']) return 'ok';
    const msg = body.Information ?? body.Note ?? body['Error Message'] ?? '';
    if (/rate limit|requests per day/i.test(msg)) return 'limited';
    return 'invalid';
  } catch { return 'unavailable'; }
}

export function createAlphaVantage(apiKey: string, onInvalid?: () => void) {
  const series = async (sym: string): Promise<Bar[]> => {
    const ns = await hashKey(apiKey);
    const k = `${ns}:${sym}`;
    const hit = memo.get(k); if (hit && hit.until > Date.now()) return hit.value;
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const cacheKey = new Request(`https://cache.markets.internal/alphavantage/${ns}/${encodeURIComponent(sym)}`);
    const cached = cache ? await cache.match(cacheKey).catch(() => undefined) : undefined;
    let bars: Bar[] | null = cached ? await cached.json() as Bar[] : null;
    if (!bars) {
      let body: AvResponse | null = null;
      for (const size of ['full', 'compact']) {
        const res = await rawFetch(`${BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=${size}&apikey=${encodeURIComponent(apiKey)}`).catch(() => null);
        if (!res?.ok) throw new UpstreamError(504, 'Alpha Vantage did not answer.');
        body = await res.json() as AvResponse;
        if (body['Time Series (Daily)'] || !/premium/i.test(body.Information ?? '')) break;
      }
      const err = classify(body!);
      if (err) { if (err.status === 401) onInvalid?.(); throw err; }
      const s = body!['Time Series (Daily)']!;
      bars = Object.keys(s).sort().filter(d => d >= '2021-11-15').map(d => ({ date: d, open: r4(+s[d]['1. open']), high: r4(+s[d]['2. high']), low: r4(+s[d]['3. low']), close: r4(+s[d]['4. close']), adjClose: r4(+s[d]['4. close']), volume: Number(s[d]['5. volume']) || null }));
      if (cache) await cache.put(cacheKey, new Response(JSON.stringify(bars), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=21600' } })).catch(() => null);
    }
    if (memo.size > 2000) memo.clear();
    memo.set(k, { until: Date.now() + 6 * 3600_000, value: bars });
    return bars;
  };
  const meta = (observedAt: string | null, notes: string[]) => ({ provider: 'alphavantage', provenance: 'production' as const, observedAt, retrievedAt: new Date().toISOString(), delaySeconds: 86400, notes });

  return {
    info: alphaVantageInfo,
    /** The latest daily close compared with the one before (end of day, not live). */
    async quote(inst: Instrument, sym: string, now: Date): Promise<Quote> {
      const bars = await this.history(inst, sym, now, true);
      const last = bars.at(-1), prev = bars.at(-2) ?? last;
      if (!last) throw new UpstreamError(404, `Alpha Vantage has no prices for ${inst.symbol}.`);
      const p = D(last.close), pc = D(prev!.close);
      return {
        instrumentId: inst.id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pc.eq(0) ? '0.00' : pct(p.minus(pc).div(pc).times(100)),
        dayHigh: last.high, dayLow: last.low, currency: inst.currency, session: sessionStatus(inst.exchange, inst.assetClass, now),
        meta: meta(`${last.date}T21:00:00Z`, ['Latest daily close via your Alpha Vantage key (end of day, not live). Shown only to you.']),
      };
    },
    async history(inst: Instrument, sym: string, now: Date, includeToday = false): Promise<Bar[]> {
      const bars = await series(sym);
      if (includeToday) return bars;
      const { date: today, hour } = localParts(now, inst.timezone);
      return bars.filter(b => b.date < today || hour >= 17);
    },
    statistics(inst: Instrument, bars: Bar[]): Statistics {
      const year = bars.slice(-252);
      return {
        instrumentId: inst.id,
        fiftyTwoWeekHigh: year.length ? r4(Math.max(...year.map(b => Number(b.high)))) : null, fiftyTwoWeekLow: year.length ? r4(Math.min(...year.map(b => Number(b.low)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 252)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.close) }))).pct),
        marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null,
        meta: meta(bars.at(-1) ? `${bars.at(-1)!.date}T21:00:00Z` : null, ['Computed from daily prices via your Alpha Vantage key (not dividend-adjusted).']),
      };
    },
  };
}
export type AlphaVantage = ReturnType<typeof createAlphaVantage>;
