// Yahoo Finance research adapter. ISOLATED AND DISABLED BY DEFAULT.
//
// Yahoo's chart endpoint is unofficial. Being able to call it does not grant the right to display its
// data publicly or redistribute it through an API, so this adapter's rights are internal-only and the
// registry never routes public requests to it. It exists to compare against the demo provider during
// development (YAHOO_RESEARCH=enabled in .dev.vars) and to keep the provider contract honest. If
// Yahoo can't be licensed for the intended public use, an approved provider replaces it behind the
// same Markets API contract.
import { D, pct, price as fmtPrice } from '../../domain/decimal';
import type { Bar } from '../../domain/types';
import type { ProviderInfo } from './types';

export const yahooInfo = (enabled: boolean): ProviderInfo => ({
  id: 'yahoo-research', name: 'Yahoo Finance (research adapter)', provenance: 'research', enabled, delaySeconds: null,
  assetClasses: ['stock', 'etf', 'mutual_fund', 'crypto', 'index', 'fx'],
  rights: { internalProcessing: true, publicDisplay: false, apiRedistribution: false, derivedAnalytics: false, cachingSeconds: 0, newsContent: 'none', notes: 'Unofficial endpoint. No licence for public display, redistribution or derived public analytics has been obtained.' },
});

/** Markets ID -> Yahoo symbol. */
export function yahooSymbol(id: string, symbol: string): string {
  const [ex] = id.split('.');
  if (ex === 'xtse') return `${symbol}.TO`;
  if (ex === 'crypto') return symbol;
  if (ex === 'fx') return `${symbol}=X`;
  if (id === 'index.spx') return '^GSPC';
  if (id === 'index.ixic') return '^IXIC';
  if (id === 'index.tsx') return '^GSPTSE';
  return symbol;
}

async function fetchWithRetry(url: string, fetcher: typeof fetch, tries = 3, timeoutMs = 6000): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetcher(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Markets-research)' } });
      clearTimeout(t);
      if (r.status === 429 || r.status >= 500) { last = new Error(`upstream ${r.status}`); await new Promise(res => setTimeout(res, 250 * 2 ** i)); continue; }
      return r;
    } catch (e) { clearTimeout(t); last = e; await new Promise(res => setTimeout(res, 250 * 2 ** i)); }
  }
  throw last instanceof Error ? last : new Error('upstream failed');
}

/** Parses Yahoo's v8 chart response into Markets bars. Exported for tests with recorded fixtures. */
export function parseChart(json: any): { bars: Bar[]; price: string | null; previousClose: string | null; currency: string | null } {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description ?? 'Unexpected response');
  const ts: number[] = r.timestamp ?? []; const q = r.indicators?.quote?.[0] ?? {}; const adj = r.indicators?.adjclose?.[0]?.adjclose ?? q.close;
  const bars: Bar[] = [];
  ts.forEach((t, i) => {
    if (q.close?.[i] == null) return; // missing session, not zero
    const f = (v: number | null) => (v == null ? null : D(v.toFixed(6)).toString());
    bars.push({ date: new Date(t * 1000).toISOString().slice(0, 10), open: f(q.open[i]) ?? f(q.close[i])!, high: f(q.high[i]) ?? f(q.close[i])!, low: f(q.low[i]) ?? f(q.close[i])!, close: f(q.close[i])!, adjClose: f(adj?.[i]) ?? f(q.close[i])!, volume: q.volume?.[i] ?? null });
  });
  const m = r.meta ?? {};
  return { bars, price: m.regularMarketPrice != null ? fmtPrice(D(m.regularMarketPrice)) : null, previousClose: m.chartPreviousClose != null ? fmtPrice(D(m.chartPreviousClose)) : null, currency: m.currency ?? null };
}

export function createYahooResearch(enabled: boolean, fetcher: typeof fetch = fetch) {
  return {
    info: yahooInfo(enabled),
    async chart(id: string, symbol: string, range = '1y') {
      if (!enabled) throw Object.assign(new Error('The Yahoo research adapter is disabled.'), { code: 'provider_disabled' });
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(id, symbol))}?range=${range}&interval=1d&events=div,splits`;
      const res = await fetchWithRetry(url, fetcher);
      if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
      const parsed = parseChart(await res.json());
      const chg = parsed.price && parsed.previousClose ? pct(D(parsed.price).minus(D(parsed.previousClose)).div(D(parsed.previousClose)).times(100)) : null;
      return { ...parsed, changePct: chg };
    },
  };
}
