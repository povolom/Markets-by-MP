// Chooses which provider serves which instrument, and what each audience may see.
//   Stocks, ETFs, funds, indexes: generated demo data (no free source is licensed for public display).
//   Crypto: CoinGecko (real; display with attribution, not redistributed through the public API).
//   FX: European Central Bank reference rates via Frankfurter (real; reusable with credit).
// MARKET_DATA=offline uses demo data for everything (tests, working without a network).
// If a real provider fails, the API returns an error. It never substitutes demo data.
import type { Instrument } from '../../domain/types';
import { createCoinGecko } from './coingecko';
import { createDemoProvider } from './demo';
import { createEcb } from './ecb';
import { createYahooResearch } from './yahoo-research';
import { ENTRIES, FEATURED, INSTRUMENTS, type Source } from './universe';
import type { MarketDataProvider, ProviderInfo } from './types';

export interface Registry {
  market: MarketDataProvider;          // every instrument, for the Markets app
  providers: ProviderInfo[];           // everything configured, for /coverage
  sourceOf: (id: string) => ProviderInfo;
  research: ReturnType<typeof createYahooResearch>;
}

let demo: MarketDataProvider | null = null;

export function getRegistry(env: { YAHOO_RESEARCH?: string; MARKET_DATA?: string; COINGECKO_API_KEY?: string }): Registry {
  demo ??= createDemoProvider();
  const d = demo;
  const offline = env.MARKET_DATA === 'offline';
  const cg = createCoinGecko(env.COINGECKO_API_KEY);
  const ecb = createEcb();
  const research = createYahooResearch(env.YAHOO_RESEARCH === 'enabled');
  const src = (id: string): Source => offline ? 'demo' : ENTRIES.get(id)?.source ?? 'demo';
  const infoFor: Record<Source, ProviderInfo> = { demo: d.info, coingecko: cg.info, ecb: ecb.info };
  const cgId = (id: string) => { const e = ENTRIES.get(id); if (!e?.coingeckoId) throw new Error(`No CoinGecko ID for ${id}`); return e.coingeckoId; };
  const pair = (inst: Instrument) => inst.symbol.replace(/[^A-Z]/g, '').slice(0, 6);

  const market: MarketDataProvider = {
    info: { id: 'markets', name: 'Markets combined data', provenance: offline ? 'demo' : 'production', enabled: true, delaySeconds: null, assetClasses: d.info.assetClasses, rights: d.info.rights },
    instruments: () => INSTRUMENTS,
    featured: () => FEATURED,
    instrument: id => ENTRIES.get(id)?.inst,
    async history(id) {
      const s = src(id);
      if (s === 'coingecko') return cg.history(cgId(id));
      if (s === 'ecb') return ecb.history(pair(ENTRIES.get(id)!.inst));
      return d.history(id);
    },
    async quote(id, now) {
      const s = src(id); const inst = ENTRIES.get(id)!.inst;
      if (s === 'coingecko') return cg.quote(id, cgId(id));
      if (s === 'ecb') return ecb.quote(id, pair(inst), inst.currency);
      return d.quote(id, now);
    },
    async dividends(id, now) { return src(id) === 'demo' ? d.dividends(id, now) : []; },
    async events(id, now) { return src(id) === 'demo' ? d.events(id, now) : []; },
    async news(id, now) { return id && src(id) !== 'demo' ? [] : d.news(id, now); },
    async statistics(id, now) {
      if (src(id) === 'coingecko') return cg.statistics(id, cgId(id), await cg.history(cgId(id)));
      if (src(id) === 'ecb') return { instrumentId: id, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, volatility1y: null, maxDrawdown1y: null, marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null, meta: (await this.quote(id, now)).meta };
      return d.statistics(id, now);
    },
    async financials(id, now) { return src(id) === 'demo' ? d.financials(id, now) : null; },
    composition: id => d.composition(id),
    async fxRate(from, to, date) {
      if (!offline && ecb.supports(from, to)) return ecb.rate(from, to, date);
      return d.fxRate(from, to, date);
    },
  };
  return { market, providers: offline ? [d.info, research.info] : [d.info, cg.info, ecb.info, research.info], sourceOf: id => infoFor[src(id)], research };
}
