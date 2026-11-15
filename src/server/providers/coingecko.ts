// Real crypto prices from CoinGecko's API (keyless, or a free Demo key in COINGECKO_API_KEY).
// Terms: display with attribution ("Data provided by CoinGecko"); no redistribution, so the public
// Markets API does not serve these prices to outside clients. Only the Markets app shows them.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import { annualizedVolatility, dailyReturns, fmtPct, maxDrawdown } from '../../domain/stats';
import type { Bar, Quote, Statistics } from '../../domain/types';
import { cachedJson, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';

export const coingeckoInfo: ProviderInfo = {
  id: 'coingecko', name: 'CoinGecko', provenance: 'production', enabled: true, delaySeconds: 60,
  assetClasses: ['crypto'],
  rights: { internalProcessing: true, publicDisplay: true, apiRedistribution: false, derivedAnalytics: true, cachingSeconds: 60, newsContent: 'none', notes: 'Shown in the Markets app with attribution ("Data provided by CoinGecko"). Not redistributed through the public Markets API.' },
};

const BASE = 'https://api.coingecko.com/api/v3';

interface MarketRow { id: string; current_price: number | null; market_cap: number | null; high_24h: number | null; low_24h: number | null; price_change_percentage_24h: number | null; last_updated: string | null }

/** Prices under $1 keep more decimals (some coins trade at fractions of a cent). */
const cp = (v: ReturnType<typeof D>) => v.abs().gte(1) ? fmtPrice(v) : v.abs().gte('0.01') ? v.round(6).toString() : v.round(10).toString();
const r8 = (n: number) => { const a = Math.abs(n); return String(Math.round(n * (a >= 1 ? 1e4 : a >= 0.01 ? 1e6 : 1e8)) / (a >= 1 ? 1e4 : a >= 0.01 ? 1e6 : 1e8)); };

export function createCoinGecko(apiKey?: string) {
  const headers: Record<string, string> = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  const meta = (observedAt: string | null) => ({ provider: 'coingecko', provenance: 'production' as const, observedAt, retrievedAt: new Date().toISOString(), delaySeconds: 60, notes: ['Data provided by CoinGecko.'] });

  /** The top 250 coins in one call, refreshed every minute: every crypto quote is served from it. */
  const top = async () => {
    const rows = await cachedJson<MarketRow[]>(`${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h`, 60, headers);
    return new Map(rows.map(r => [r.id, r]));
  };
  const row = async (cg: string): Promise<MarketRow> => {
    const hit = (await top()).get(cg); if (hit) return hit;
    const rows = await cachedJson<MarketRow[]>(`${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cg)}`, 60, headers);
    if (!rows[0]) throw new UpstreamError(404, 'CoinGecko has no price for this coin.');
    return rows[0];
  };

  return {
    info: coingeckoInfo,
    async quote(id: string, cg: string): Promise<Quote> {
      const r = await row(cg);
      if (r.current_price == null) throw new UpstreamError(502, 'CoinGecko returned no price.');
      const price = D(r8(r.current_price));
      const chg = r.price_change_percentage_24h ?? 0;
      const prev = price.div(D(1).plus(D(chg).div(100)));
      return { instrumentId: id, price: cp(price), previousClose: cp(D(r8(Number(prev)))), change: cp(price.minus(D(r8(Number(prev))))), changePct: pct(D(chg)), dayHigh: r.high_24h == null ? null : r8(r.high_24h), dayLow: r.low_24h == null ? null : r8(r.low_24h), currency: 'USD', session: 'always_open', meta: { ...meta(r.last_updated), notes: ['Data provided by CoinGecko.', 'Change is over the last 24 hours.'] } };
    },
    /** Daily closes for the last year (the keyless API's limit), completed UTC days only. */
    async history(cg: string): Promise<Bar[]> {
      const d = await cachedJson<{ prices: [number, number][]; total_volumes: [number, number][] }>(`${BASE}/coins/${encodeURIComponent(cg)}/market_chart?vs_currency=usd&days=365&interval=daily`, 6 * 3600, headers);
      const today = new Date().toISOString().slice(0, 10);
      const byDay = new Map<string, { c: number; v: number | null }>();
      d.prices.forEach(([t, p], i) => { const day = new Date(t).toISOString().slice(0, 10); if (day < today) byDay.set(day, { c: p, v: d.total_volumes[i]?.[1] ?? null }); });
      const days = [...byDay.keys()].sort();
      return days.map((day, i) => {
        const c = byDay.get(day)!.c, o = i ? byDay.get(days[i - 1])!.c : c;
        return { date: day, open: r8(o), high: r8(Math.max(o, c)), low: r8(Math.min(o, c)), close: r8(c), adjClose: r8(c), volume: byDay.get(day)!.v == null ? null : Math.round(byDay.get(day)!.v!) };
      });
    },
    async statistics(id: string, cg: string, bars: Bar[]): Promise<Statistics> {
      const r = await row(cg).catch(() => null);
      const year = bars.slice(-365);
      return {
        instrumentId: id,
        fiftyTwoWeekHigh: year.length ? r8(Math.max(...year.map(b => Number(b.close)))) : null, fiftyTwoWeekLow: year.length ? r8(Math.min(...year.map(b => Number(b.close)))) : null,
        volatility1y: fmtPct(annualizedVolatility(dailyReturns(year), 365)), maxDrawdown1y: fmtPct(maxDrawdown(year.map(b => ({ date: b.date, value: Number(b.close) }))).pct),
        marketCap: r?.market_cap ? String(Math.round(r.market_cap)) : null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null,
        meta: { ...meta(r?.last_updated ?? null), notes: ['Data provided by CoinGecko.', '52-week range uses daily closes.'] },
      };
    },
  };
}
export type CoinGecko = ReturnType<typeof createCoinGecko>;
