// Yahoo Finance chart data, for personal mode only: the desktop app (or a self-hosted copy) fetching prices
// for the one person who runs it, from their own computer. Never used by the public showcase, and never
// redistributed: Yahoo has no official API and its data isn't licensed for publishing.
// Covers stocks, ETFs and indexes on US, Canadian and most international exchanges, with no key.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { localParts, sessionStatus } from '../../domain/market-hours';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, DividendRecord, Instrument, Quote, Statistics } from '../../domain/types';
import { cachedJson, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';
import { US_MICS } from './alpaca';

export const yahooInfo: ProviderInfo = {
  id: 'yahoo', name: 'Yahoo Finance (personal use on your own device)', provenance: 'production', enabled: true, delaySeconds: null,
  assetClasses: ['stock', 'etf', 'index'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 60, newsContent: 'none', notes: 'Unofficial. Used only in personal mode, for the person running the app on their own device. Never published or redistributed.' },
};

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
// A plain header works; claiming to be a full browser without being one gets rate limited.
const UA = { 'user-agent': 'Mozilla/5.0', accept: '*/*' };
const INDEX: Record<string, string> = { 'index.spx': '^GSPC', 'index.ixic': '^IXIC', 'index.tsx': '^GSPTSE', 'index.dji': '^DJI' };

export function yahooSymbol(inst: Instrument): string | null {
  if (inst.assetClass === 'index') return INDEX[inst.id] ?? null;
  if (inst.assetClass !== 'stock' && inst.assetClass !== 'etf') return null;
  const s = inst.symbol.replace(/\./g, '-');
  if (inst.exchange === 'XTSE') return `${s}.TO`;
  if (inst.exchange === 'XTSX') return `${s}.V`;
  if (US_MICS.has(inst.exchange)) return s;
  return null;
}

interface Chart {
  chart: { result: [{
    meta: { regularMarketPrice?: number; regularMarketTime?: number; regularMarketDayHigh?: number; regularMarketDayLow?: number; currency?: string; exchangeTimezoneName?: string };
    timestamp?: number[];
    indicators: { quote: [{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }]; adjclose?: [{ adjclose: (number | null)[] }] };
    events?: { dividends?: Record<string, { amount: number; date: number }> };
  }] | null; error: { description?: string } | null };
}

const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);
const chart = async (sym: string, range: string, ttl: number) => {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
  let d: Chart | null = null, last: unknown = null;
  for (const host of HOSTS) {
    try { d = await cachedJson<Chart>(`${host}${path}`, ttl, UA); break; }
    catch (e) { last = e; if ((e as { status?: number }).status === 404) break; }
  }
  if (!d) throw last;
  const r = d.chart?.result?.[0];
  if (!r) throw new UpstreamError(404, d.chart?.error?.description ?? 'Yahoo has no data for this symbol.');
  return r;
};
function toBars(r: NonNullable<Chart['chart']['result']>[0], tz: string): Bar[] {
  const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose ?? [];
  const out: Bar[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const c = q.close[i]; if (c == null) return;
    const o = q.open[i] ?? c, h = q.high[i] ?? Math.max(o, c), l = q.low[i] ?? Math.min(o, c);
    out.push({ date: localParts(new Date(t * 1000), tz).date, open: r4(o), high: r4(h), low: r4(l), close: r4(c), adjClose: r4(adj[i] ?? c), volume: q.volume[i] ?? null });
  });
  // One bar per date (the last wins), oldest first.
  return [...new Map(out.map(b => [b.date, b])).values()];
}

export function createYahoo() {
  return {
    info: yahooInfo,
    async quote(inst: Instrument, sym: string, now: Date): Promise<Quote> {
      const r = await chart(sym, '5d', 60);
      const price = r.meta.regularMarketPrice;
      if (price == null) throw new UpstreamError(404, `Yahoo has no current price for ${inst.symbol}.`);
      const bars = toBars(r, inst.timezone);
      const tradeDay = r.meta.regularMarketTime ? localParts(new Date(r.meta.regularMarketTime * 1000), inst.timezone).date : bars.at(-1)?.date;
      const prevBar = bars.at(-1)?.date === tradeDay ? bars.at(-2) : bars.at(-1);
      const p = D(r4(price)), pc = D(prevBar?.close ?? r4(price));
      return {
        instrumentId: inst.id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pc.eq(0) ? '0.00' : pct(p.minus(pc).div(pc).times(100)),
        dayHigh: r.meta.regularMarketDayHigh != null ? r4(r.meta.regularMarketDayHigh) : null, dayLow: r.meta.regularMarketDayLow != null ? r4(r.meta.regularMarketDayLow) : null,
        currency: inst.currency, session: sessionStatus(inst.exchange, inst.assetClass, now),
        meta: { provider: 'yahoo', provenance: 'production', observedAt: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : null, retrievedAt: new Date().toISOString(), delaySeconds: null, notes: ['Yahoo Finance, fetched on your own device for your personal use.'] },
      };
    },
    /** Completed daily sessions for five years, with dividend-adjusted closes. */
    async history(inst: Instrument, sym: string, now: Date): Promise<Bar[]> {
      const bars = toBars(await chart(sym, '5y', 6 * 3600), inst.timezone);
      const { date: today, hour } = localParts(now, inst.timezone);
      return bars.filter(b => b.date < today || hour >= 17);
    },
    async dividends(inst: Instrument, sym: string, now: Date): Promise<DividendRecord[]> {
      if (inst.assetClass === 'index') return [];
      const r = await chart(sym, '5y', 6 * 3600);
      const today = localParts(now, 'UTC').date;
      return Object.values(r.events?.dividends ?? {}).sort((a, b) => a.date - b.date)
        .map(d => { const ex = localParts(new Date(d.date * 1000), inst.timezone).date; return { exDate: ex, payDate: null, amount: r4(d.amount), currency: r.meta.currency ?? inst.currency, status: (ex <= today ? 'paid' : 'declared') as DividendRecord['status'] }; });
    },
    statistics(inst: Instrument, bars: Bar[], divs: DividendRecord[]): Statistics {
      const year = bars.slice(-252), last = Number(bars.at(-1)?.close ?? 0);
      const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const ttm = divs.filter(d => d.exDate >= since).reduce((s, d) => s + Number(d.amount), 0);
      return {
        instrumentId: inst.id,
        fiftyTwoWeekHigh: year.length ? r4(Math.max(...year.map(b => Number(b.high)))) : null, fiftyTwoWeekLow: year.length ? r4(Math.min(...year.map(b => Number(b.low)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 252)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.adjClose) }))).pct),
        marketCap: null, peRatio: null, dividendYield: inst.assetClass !== 'index' && last ? (ttm / last * 100).toFixed(2) : null, expenseRatio: null, beta: null,
        meta: { provider: 'yahoo', provenance: 'production', observedAt: bars.at(-1) ? `${bars.at(-1)!.date}T21:00:00Z` : null, retrievedAt: new Date().toISOString(), delaySeconds: null, notes: ['Computed from Yahoo Finance daily prices on your device. Dividend yield is the last 12 months of payments over the latest close.'] },
      };
    },
  };
}
export type Yahoo = ReturnType<typeof createYahoo>;
