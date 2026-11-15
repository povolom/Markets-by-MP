// Market service: normalizes provider data into the Markets API contract. Used by the public API,
// the private API and the alert job, so the app and the API always agree.
import { D, pct, price as fmtPrice } from '../domain/decimal';
import { evaluateRule } from '../domain/dips';
import { similarAndDifferent } from '../domain/similar';
import type { Bar, Instrument, NewsItem, Quote } from '../domain/types';
import { coalesce } from './middleware';
import { ApiError, notFound } from './http';
import type { MarketDataProvider, ProviderInfo } from './providers/types';
import { resolveSymbol, searchInstruments } from './search-index';

export const RANGES = { '1M': 31, '3M': 92, '6M': 183, 'YTD': -1, '1Y': 366, '5Y': 1830, 'MAX': 1830 } as const;
export type Range = keyof typeof RANGES;
export const MAX_HISTORY_DAYS = 1830;   // five years of daily bars
export const MAX_BATCH = 50;

export interface MarketOptions {
  /** 'app' = the Markets app; 'api' = outside clients, who only get data a provider allows Markets to redistribute. */
  audience: 'app' | 'api';
  sourceOf: (id: string) => ProviderInfo;
  /** Separates in-flight request sharing between markets (each user's own key gets its own). */
  namespace?: string;
}

export function createMarket(p: MarketDataProvider, providers: ProviderInfo[], opts: MarketOptions = { audience: 'app', sourceOf: () => p.info }) {
  const allowed = (id: string) => opts.audience === 'app' || opts.sourceOf(id).rights.apiRedistribution;
  const inst = (id: string): Instrument => {
    const i = p.instrument(id); if (!i) throw notFound(`Instrument "${id}"`);
    if (!allowed(id)) throw new ApiError(403, 'not_licensed', `${opts.sourceOf(id).name} data is shown in the Markets app with credit, but its terms don't allow Markets to redistribute it through the public API.`);
    return i;
  };
  const featured = () => (p.featured?.() ?? p.instruments()).filter(i => allowed(i.id));
  const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError) throw e;
      const status = (e as { status?: number }).status;
      throw new ApiError(status === 429 ? 503 : 502, 'upstream_error', `The data provider couldn't return ${what} right now${status === 429 ? ' (it is limiting requests; try again in a minute)' : ''}. No substitute data was used.`);
    }
  };

  let coverageCache: ReturnType<typeof svc.computeCoverage> | null = null;
  const svc = {
    provider: p, providers,
    instrument: inst,
    instruments: () => p.instruments(),
    lookup: (id: string) => p.instrument(id),
    resolveSymbol(symbol: string): string | null { const id = resolveSymbol(symbol); return id && allowed(id) ? id : null; },
    /** Finds instruments by symbol, company name, nickname or a close misspelling, best match first. */
    search(q: string, assetClass?: string) { return searchInstruments(q, i => (!assetClass || i.assetClass === assetClass) && allowed(i.id)); },
    sourceOf: (id: string) => opts.sourceOf(id),
    quote: (id: string): Promise<Quote> => { inst(id); return coalesce(`${opts.namespace ?? opts.audience}:q:${id}`, () => guard('a quote', () => p.quote(id, new Date()))); },
    /** Batch quotes. A locked instrument comes back as { instrumentId, locked } instead of failing the batch. */
    async quotes(ids: string[]) {
      if (ids.length > MAX_BATCH) throw new ApiError(400, 'bad_request', `At most ${MAX_BATCH} instruments per request.`);
      return Promise.all(ids.map(id => svc.quote(id).catch(e => {
        if (!(e instanceof ApiError && e.code === 'locked')) return { instrumentId: id, unavailable: true, message: e instanceof Error ? e.message : 'Unavailable', price: null, previousClose: null, change: null, changePct: null, currency: p.instrument(id)?.currency ?? 'USD', meta: null } as unknown as Quote;
        if (e instanceof ApiError && e.code === 'locked') return { instrumentId: id, locked: true, lockReason: (e.details as { reason?: string })?.reason ?? 'needs_key', message: e.message, price: null, previousClose: null, change: null, changePct: null, currency: inst(id).currency, meta: null } as unknown as Quote;
        throw e;
      })));
    },
    fullHistory: (id: string): Promise<Bar[]> => { inst(id); return coalesce(`${opts.namespace ?? opts.audience}:h:${id}`, () => guard('price history', () => p.history(id))); },
    async history(id: string, range: Range | undefined, from?: string, to?: string) {
      const bars = await svc.fullHistory(id);
      const last = bars[bars.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
      let start: string;
      if (from) {
        const span = (Date.parse(to ?? last) - Date.parse(from)) / 86400000;
        if (!(span >= 0)) throw new ApiError(400, 'bad_request', '"from" must be on or before "to".');
        if (span > MAX_HISTORY_DAYS) throw new ApiError(400, 'bad_request', `Date ranges are limited to ${MAX_HISTORY_DAYS} days.`);
        start = from;
      } else {
        const r = range ?? '1Y';
        start = r === 'YTD' ? `${last.slice(0, 4)}-01-01` : new Date(Date.parse(last) - (RANGES[r] - 1) * 86400000).toISOString().slice(0, 10);
      }
      return bars.filter(b => b.date >= start && b.date <= (to ?? last));
    },
    statistics: (id: string) => { inst(id); return guard('statistics', () => p.statistics(id, new Date())); },
    financials: (id: string) => { inst(id); return guard('financial statements', () => p.financials(id, new Date())); },
    dividends: (id: string) => { inst(id); return guard('dividends', () => p.dividends(id, new Date())); },
    events: (id: string) => { inst(id); return guard('events', () => p.events(id, new Date())); },
    composition: (id: string) => p.composition(id),
    async news(ids: string[] | null): Promise<NewsItem[]> {
      const lists = ids ? await Promise.all(ids.map(id => { inst(id); return p.news(id, new Date()); })) : [await p.news(null, new Date())];
      // De-duplicate by normalized title + publisher; merge the instruments they mention.
      const seen = new Map<string, NewsItem>();
      for (const n of lists.flat()) {
        const k = `${n.publisher}|${n.title.toLowerCase().replace(/\W+/g, ' ').trim()}`;
        const prev = seen.get(k);
        if (prev) prev.instrumentIds = [...new Set([...prev.instrumentIds, ...n.instrumentIds])]; else seen.set(k, { ...n });
      }
      return [...seen.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    },
    async fx(from: string, to: string, date: string | null = null) {
      return guard('an exchange rate', () => p.fxRate(from, to, date));
    },
    async related(id: string, interests: string[] = []) {
      const target = inst(id);
      const cands = featured();
      const hist = new Map<string, Bar[]>();
      await Promise.all([target, ...cands].map(async i => hist.set(i.id, (await svc.fullHistory(i.id)).slice(-253))));
      return similarAndDifferent(target, cands, x => hist.get(x), interests);
    },
    /** Drop from a reference high for one instrument, using the same rule engine as alerts. */
    async dipSnapshot(id: string, windowDays = 30, basis: 'close' | 'intraday' = 'close') {
      const [bars, q] = await Promise.all([svc.fullHistory(id), svc.quote(id)]);
      const ev = evaluateRule({ kind: windowDays >= 365 ? 'below_52w_high' : 'below_rolling_high', threshold: '0', windowDays, basis, resetBand: '0', cooldownHours: 0 }, bars, q.price, null);
      return { instrumentId: id, instrument: inst(id), quote: q, dropPct: ev.metric, reference: ev.reference, referenceDate: ev.referenceDate, windowDays, basis };
    },
    async overview() {
      const ids = ['index.spx', 'index.ixic', 'index.tsx', 'fx.usdcad', 'crypto.btc-usd', 'crypto.eth-usd'];
      const benchmarks = (await svc.quotes(ids.filter(allowed))).filter(q => !(q as any).locked && !(q as any).unavailable);
      const tradable = featured().filter(i => i.tradable && i.assetClass !== 'fx' && i.assetClass !== 'crypto');
      const qs = (await svc.quotes(tradable.map(i => i.id).slice(0, 24))).filter(q => !(q as any).locked && !(q as any).unavailable);
      const sorted = [...qs].sort((a, b) => Number(b.changePct) - Number(a.changePct));
      return { benchmarks, gainers: sorted.slice(0, 5), decliners: sorted.slice(-5).reverse(), asOf: new Date().toISOString(), meta: benchmarks[0]?.meta };
    },
    async dipScreener(o: { windowDays: number; basis: 'close' | 'intraday'; minDropPct: number; assetClass?: string; sort: 'drop' | 'daily' | 'symbol' }) {
      // Capped so a cold request stays within Cloudflare's free-plan CPU limit; your own rules can watch anything.
      const list = featured().filter(i => i.tradable && i.assetClass !== 'fx' && (!o.assetClass || i.assetClass === o.assetClass)).slice(0, 36);
      // A provider that fails for one instrument leaves it out of the scan; nothing is substituted.
      const rows = (await Promise.allSettled(list.map(i => svc.dipSnapshot(i.id, o.windowDays, o.basis)))).flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
      const hits = rows.filter(r => r.dropPct != null && Number(r.dropPct) <= -o.minDropPct);
      hits.sort((a, b) => o.sort === 'symbol' ? inst(a.instrumentId).symbol.localeCompare(inst(b.instrumentId).symbol) : o.sort === 'daily' ? Number(a.quote.changePct) - Number(b.quote.changePct) : Number(a.dropPct) - Number(b.dropPct));
      return hits;
    },
    /** Summarizing 12,000+ listings is the most expensive thing the API does; it never changes while the Worker runs, so it's computed once. */
    coverage() { return (coverageCache ??= svc.computeCoverage()); },
    computeCoverage() {
      const list = p.instruments().filter(i => allowed(i.id));
      const by = (k: keyof Instrument) => { const m = new Map<string, number>(); for (const i of list) m.set(String(i[k]), (m.get(String(i[k])) ?? 0) + 1); return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count); };
      const live = providers.filter(i => i.provenance === 'production' && (opts.audience === 'app' || i.rights.apiRedistribution));
      return {
        instrumentCount: list.length, assetClasses: by('assetClass'), exchanges: by('exchange'), currencies: by('currency'),
        sources: {
          stock: 'Demo data (generated). Listings from the Nasdaq Trader symbol directory and a curated TSX list.',
          etf: 'Demo data (generated). Listings from the Nasdaq Trader symbol directory and a curated TSX list.',
          mutual_fund: 'Demo data (generated).',
          index: 'Demo data (generated).',
          crypto: opts.audience === 'app' ? 'CoinGecko (real prices, about a minute delayed). Data provided by CoinGecko.' : 'Not available through the public API: CoinGecko\'s terms allow display in the Markets app, not redistribution.',
          fx: 'European Central Bank reference rates via Frankfurter (real, published once per working day).',
        },
        history: { interval: '1d', maxDays: MAX_HISTORY_DAYS, earliest: '2021-11-15', crypto: 'Last 365 days', adjusted: 'adjClose is adjusted for splits and distributions; close is the raw price.' },
        fields: {
          stock: ['quote', 'history', 'statistics', 'financials (curated demo profiles only)', 'dividends', 'events', 'news', 'related'],
          etf: ['quote', 'history', 'statistics', 'dividends', 'events', 'news', 'related', 'composition (curated only)'],
          mutual_fund: ['quote (end-of-day NAV)', 'history', 'statistics', 'dividends', 'composition'],
          crypto: ['quote', 'history', 'statistics (no valuation metrics)', 'related'],
          index: ['quote', 'history', 'statistics (no valuation metrics; not purchasable)'],
          fx: ['quote', 'history'],
        },
        notModelled: ['Exchange holidays (weekends only)', 'Options, futures and individual bonds (planned as separate capability extensions)', 'Intraday bars'],
        providers: providers.map(i => ({ id: i.id, name: i.name, provenance: i.provenance, enabled: i.enabled, usedForPublicApi: i.enabled && i.id !== 'yahoo-research' && i.rights.apiRedistribution, delaySeconds: i.delaySeconds, rights: i.rights })),
        dataNotice: live.length ? `Stock, ETF, fund and index prices are generated demo data until a licensed feed is connected. Real data: ${live.map(i => i.name).join('; ')}.` : 'All market data from this API is generated demo data. No licensed production market data is connected yet.',
      };
    },
  };
  return svc;
}
export type Market = ReturnType<typeof createMarket>;

export const changeSign = (v: string) => (D(v).gt(0) ? `+${v}` : v);
export { pct, fmtPrice };
