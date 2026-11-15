// Market service: normalizes provider data into the Markets API contract. Used by the public API,
// the private API and the alert job, so the app and the API always agree.
import { D, pct, price as fmtPrice } from '../domain/decimal';
import { evaluateRule } from '../domain/dips';
import { similarAndDifferent } from '../domain/similar';
import type { Bar, Instrument, NewsItem, Quote } from '../domain/types';
import { coalesce } from './middleware';
import { ApiError, notFound } from './http';
import type { MarketDataProvider, ProviderInfo } from './providers/types';
import { ALIASES } from './providers/demo-catalogue';

export const RANGES = { '1M': 31, '3M': 92, '6M': 183, 'YTD': -1, '1Y': 366, '5Y': 1830, 'MAX': 1830 } as const;
export type Range = keyof typeof RANGES;
export const MAX_HISTORY_DAYS = 1830;   // five years of daily bars
export const MAX_BATCH = 50;

// ---- Search ----
const STOP = new Set(['inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 'plc', 'the', 'group', 'holdings', 'sa', 'class', 'trust', 'etf', 'index', 'fund']);
const normalize = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => normalize(s).split(' ').filter(w => w && !STOP.has(w));
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const CLASS_WEIGHT: Record<string, number> = { stock: 3, etf: 2.5, crypto: 2, index: 1.5, mutual_fund: 1, fx: 1 };
const popularity = (i: Instrument) => CLASS_WEIGHT[i.assetClass] ?? 0;
function matchScore(i: Instrument, q: string): number {
  const sym = i.symbol.toLowerCase(), qs = q.replace(/\.to$/, '').replace(/ /g, '');
  if (sym === qs || sym.replace(/[.-]/g, '') === qs.replace(/[.-]/g, '')) return 100;
  if (q.endsWith('.to') && sym === qs && i.exchange === 'XTSE') return 100;
  const name = normalize(i.name), nameWords = words(i.name), qWords = words(q).length ? words(q) : [q];
  const aliases = (ALIASES[i.id] ?? []).map(normalize);
  if (aliases.includes(q)) return 95;
  if (sym.startsWith(qs) && qs.length >= 1) return 85 - (sym.length - qs.length);
  if (name.startsWith(q)) return 80;
  if (aliases.some(a => a.startsWith(q))) return 75;
  if (qWords.every(w => nameWords.some(nw => nw.startsWith(w)))) return 70;
  if (name.includes(q) || aliases.some(a => a.includes(q))) return 55;
  const compact = (x: string) => x.replace(/[ .-]/g, '');
  if (qs.length >= 4 && (compact(name).includes(qs) || aliases.some(a => compact(a).includes(qs)))) return 50;
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1;
    if (qWords.every(w => w.length < 4 || nameWords.some(nw => editDistance(w, nw.slice(0, Math.max(w.length, nw.length)), max) <= max || editDistance(w, nw.slice(0, w.length), max) <= max)) && qWords.some(w => w.length >= 4)) return 40;
    if (editDistance(qs, sym, 1) <= 1) return 35;
  }
  if (i.description.toLowerCase().includes(q) && q.length >= 4) return 20;
  return 0;
}

export function createMarket(p: MarketDataProvider, providers: ProviderInfo[]) {
  const inst = (id: string): Instrument => { const i = p.instrument(id); if (!i) throw notFound(`Instrument "${id}"`); return i; };
  const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(502, 'upstream_error', `The data provider couldn't return ${what} right now. No substitute data was used.`); }
  };

  const svc = {
    provider: p, providers,
    instrument: inst,
    instruments: () => p.instruments(),
    lookup: (id: string) => p.instrument(id),
    resolveSymbol(symbol: string): string | null {
      const s = symbol.trim().toUpperCase().replace(/\.TO$/, '');
      const list = p.instruments();
      const hit = list.find(i => i.id === symbol.toLowerCase()) ?? list.find(i => i.symbol === s && (symbol.toUpperCase().endsWith('.TO') ? i.exchange === 'XTSE' : true));
      return hit?.id ?? null;
    },
    /** Finds instruments by symbol, company name, nickname or a close misspelling, best match first. */
    search(q: string, assetClass?: string) {
      const list = p.instruments().filter(i => !assetClass || i.assetClass === assetClass);
      const n = normalize(q);
      if (!n) return [...list].sort((a, b) => popularity(b) - popularity(a) || a.symbol.localeCompare(b.symbol));
      const scored = list.map(i => ({ i, score: matchScore(i, n) })).filter(x => x.score > 0);
      return scored.sort((a, b) => b.score - a.score || popularity(b.i) - popularity(a.i) || a.i.symbol.localeCompare(b.i.symbol)).map(x => x.i);
    },
    quote: (id: string): Promise<Quote> => { inst(id); return coalesce(`q:${id}`, () => guard('a quote', () => p.quote(id, new Date()))); },
    async quotes(ids: string[]) {
      if (ids.length > MAX_BATCH) throw new ApiError(400, 'bad_request', `At most ${MAX_BATCH} instruments per request.`);
      return Promise.all(ids.map(id => svc.quote(id)));
    },
    fullHistory: (id: string): Promise<Bar[]> => { inst(id); return coalesce(`h:${id}`, () => guard('price history', () => p.history(id))); },
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
      const cands = p.instruments();
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
      const benchmarks = await svc.quotes(ids);
      const tradable = p.instruments().filter(i => i.tradable && i.assetClass !== 'fx');
      const qs = await svc.quotes(tradable.map(i => i.id).slice(0, MAX_BATCH));
      const sorted = [...qs].sort((a, b) => Number(b.changePct) - Number(a.changePct));
      return { benchmarks, gainers: sorted.slice(0, 5), decliners: sorted.slice(-5).reverse(), asOf: new Date().toISOString(), meta: benchmarks[0]?.meta };
    },
    async dipScreener(opts: { windowDays: number; basis: 'close' | 'intraday'; minDropPct: number; assetClass?: string; sort: 'drop' | 'daily' | 'symbol' }) {
      const list = p.instruments().filter(i => i.tradable && i.assetClass !== 'fx' && (!opts.assetClass || i.assetClass === opts.assetClass));
      const rows = await Promise.all(list.map(i => svc.dipSnapshot(i.id, opts.windowDays, opts.basis)));
      const hits = rows.filter(r => r.dropPct != null && Number(r.dropPct) <= -opts.minDropPct);
      hits.sort((a, b) => opts.sort === 'symbol' ? inst(a.instrumentId).symbol.localeCompare(inst(b.instrumentId).symbol) : opts.sort === 'daily' ? Number(a.quote.changePct) - Number(b.quote.changePct) : Number(a.dropPct) - Number(b.dropPct));
      return hits;
    },
    coverage() {
      const list = p.instruments();
      const by = (k: keyof Instrument) => Object.entries(list.reduce((m, i) => ({ ...m, [String(i[k])]: (m[String(i[k])] ?? 0) + 1 }), {} as Record<string, number>)).map(([key, count]) => ({ key, count }));
      return {
        instrumentCount: list.length, assetClasses: by('assetClass'), exchanges: by('exchange'), currencies: by('currency'),
        history: { interval: '1d', maxDays: MAX_HISTORY_DAYS, earliest: '2021-11-15', adjusted: 'adjClose is adjusted for splits and distributions; close is the raw price.' },
        fields: {
          stock: ['quote', 'history', 'statistics', 'financials', 'dividends', 'events', 'news', 'related'],
          etf: ['quote', 'history', 'statistics', 'dividends', 'events', 'news', 'related', 'composition'],
          mutual_fund: ['quote (end-of-day NAV)', 'history', 'statistics', 'dividends', 'composition'],
          crypto: ['quote', 'history', 'statistics (no valuation metrics)', 'news', 'related'],
          index: ['quote', 'history', 'statistics (no valuation metrics; not purchasable)'],
          fx: ['quote', 'history'],
        },
        notModelled: ['Exchange holidays (weekends only)', 'Options, futures and individual bonds (planned as separate capability extensions)', 'Intraday bars'],
        providers: providers.map(i => ({ id: i.id, name: i.name, provenance: i.provenance, enabled: i.enabled, usedForPublicApi: i.id === p.info.id, delaySeconds: i.delaySeconds, rights: i.rights })),
        dataNotice: p.info.provenance === 'demo' ? 'All market data from this API is generated demo data. No licensed production market data is connected yet.' : null,
      };
    },
  };
  return svc;
}
export type Market = ReturnType<typeof createMarket>;

export const changeSign = (v: string) => (D(v).gt(0) ? `+${v}` : v);
export { pct, fmtPrice };
