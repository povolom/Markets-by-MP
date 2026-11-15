// Real exchange rates: European Central Bank reference rates, served by Frankfurter (frankfurter.dev).
// Published once per working day around 16:00 CET. The ECB allows reuse with the source credited.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import type { Bar, Quote } from '../../domain/types';
import { cachedJson, UpstreamError } from './fetch-cache';
import type { ProviderInfo } from './types';

export const ecbInfo: ProviderInfo = {
  id: 'ecb', name: 'European Central Bank reference rates (via Frankfurter)', provenance: 'production', enabled: true, delaySeconds: 86400,
  assetClasses: ['fx'],
  rights: { internalProcessing: true, publicDisplay: true, apiRedistribution: true, derivedAnalytics: true, cachingSeconds: 3600, newsContent: 'none', notes: 'Reference rates for information only, published once per working day. Source: European Central Bank.' },
};

const BASE = 'https://api.frankfurter.dev/v1';
export const ECB_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'MXN', 'CNY', 'INR'];
const START = '2021-11-01';
const SYMBOLS = ECB_CURRENCIES.filter(c => c !== 'USD').join(',');

type Rates = Record<string, number>;

export function createEcb() {
  const meta = (date: string) => ({ provider: 'ecb', provenance: 'production' as const, observedAt: `${date}T15:00:00Z`, retrievedAt: new Date().toISOString(), delaySeconds: 86400, notes: ['European Central Bank reference rate.'] });
  /** Every working day since START, USD-based: { date: { CAD: 1.36, ... } } */
  const series = async () => {
    const d = await cachedJson<{ rates: Record<string, Rates> }>(`${BASE}/${START}..?base=USD&symbols=${SYMBOLS}`, 3600);
    const dates = Object.keys(d.rates).sort();
    return { dates, rates: d.rates };
  };
  const cross = (r: Rates, from: string, to: string) => {
    const usd = (c: string) => c === 'USD' ? 1 : r[c];
    const a = usd(from), b = usd(to);
    if (a == null || b == null) throw new UpstreamError(404, `No ECB reference rate for ${from}/${to}.`);
    return b / a;
  };
  const r6 = (n: number) => String(Math.round(n * 1e6) / 1e6);

  return {
    info: ecbInfo,
    supports: (from: string, to: string) => ECB_CURRENCIES.includes(from) && ECB_CURRENCIES.includes(to),
    async rate(from: string, to: string, date: string | null): Promise<string> {
      if (from === to) return '1';
      const { dates, rates } = await series();
      if (!dates.length) throw new UpstreamError(502, 'No ECB rates available.');
      let pick = dates[dates.length - 1];
      if (date) { pick = dates[0]; for (const d of dates) { if (d > date) break; pick = d; } }
      return r6(cross(rates[pick], from, to));
    },
    async history(pair: string): Promise<Bar[]> {
      const from = pair.slice(0, 3), to = pair.slice(3, 6);
      const { dates, rates } = await series();
      return dates.map((d, i) => {
        const c = cross(rates[d], from, to), o = i ? cross(rates[dates[i - 1]], from, to) : c;
        return { date: d, open: r6(o), high: r6(Math.max(o, c)), low: r6(Math.min(o, c)), close: r6(c), adjClose: r6(c), volume: null };
      });
    },
    async quote(id: string, pair: string, quoteCcy: string): Promise<Quote> {
      const bars = await this.history(pair);
      const last = bars[bars.length - 1], prev = bars[bars.length - 2] ?? last;
      const p = D(last.close), pc = D(prev.close);
      return { instrumentId: id, price: fmtPrice(p), previousClose: fmtPrice(pc), change: fmtPrice(p.minus(pc)), changePct: pct(p.minus(pc).div(pc).times(100)), dayHigh: null, dayLow: null, currency: quoteCcy, session: 'closed', meta: { ...meta(last.date), notes: ['European Central Bank reference rate, published once per working day.', 'Change is against the previous reference rate.'] } };
    },
  };
}
export type Ecb = ReturnType<typeof createEcb>;
