// Chooses which provider serves which instrument, and what each audience may see.
//   Stocks, ETFs, funds, indexes: generated demo data (no free source is licensed for public display).
//   Crypto: CoinGecko (real; display with attribution, not redistributed through the public API).
//   FX: European Central Bank reference rates via Frankfurter (real; reusable with credit).
// MARKET_DATA=offline uses demo data for everything (tests, working without a network).
// If a real provider fails, the API returns an error. It never substitutes demo data.
import type { Instrument } from '../../domain/types';
import { ApiError } from '../http';
import { US_MICS, type Alpaca } from './alpaca';
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

  // Listings outside the curated catalogue have no free price source Markets may show to everyone. They stay
  // searchable, but prices unlock only through the viewer's own data key (US) or a future licensed feed.
  const locked = (id: string) => { const e = ENTRIES.get(id); return Boolean(e && e.source === 'demo' && !e.curated && (e.inst.assetClass === 'stock' || e.inst.assetClass === 'etf')); };
  const guard = (id: string) => { if (locked(id)) throw lockedError(ENTRIES.get(id)!.inst); };

  const market: MarketDataProvider = {
    info: { id: 'markets', name: 'Markets combined data', provenance: offline ? 'demo' : 'production', enabled: true, delaySeconds: null, assetClasses: d.info.assetClasses, rights: d.info.rights },
    instruments: () => INSTRUMENTS,
    featured: () => FEATURED,
    instrument: id => ENTRIES.get(id)?.inst,
    async history(id) {
      guard(id);
      const s = src(id);
      if (s === 'coingecko') return cg.history(cgId(id));
      if (s === 'ecb') return ecb.history(pair(ENTRIES.get(id)!.inst));
      return d.history(id);
    },
    async quote(id, now) {
      guard(id);
      const s = src(id); const inst = ENTRIES.get(id)!.inst;
      if (s === 'coingecko') return cg.quote(id, cgId(id));
      if (s === 'ecb') return ecb.quote(id, pair(inst), inst.currency);
      return d.quote(id, now);
    },
    async dividends(id, now) { guard(id); return src(id) === 'demo' ? d.dividends(id, now) : []; },
    async events(id, now) { guard(id); return src(id) === 'demo' ? d.events(id, now) : []; },
    async news(id, now) { return id && src(id) !== 'demo' ? [] : d.news(id, now); },
    async statistics(id, now) {
      guard(id);
      if (src(id) === 'coingecko') return cg.statistics(id, cgId(id), await cg.history(cgId(id)));
      if (src(id) === 'ecb') return { instrumentId: id, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, volatility1y: null, maxDrawdown1y: null, marketCap: null, peRatio: null, dividendYield: null, expenseRatio: null, beta: null, meta: (await this.quote(id, now)).meta };
      return d.statistics(id, now);
    },
    async financials(id, now) { guard(id); return src(id) === 'demo' ? d.financials(id, now) : null; },
    composition: id => d.composition(id),
    async fxRate(from, to, date) {
      if (!offline && ecb.supports(from, to)) return ecb.rate(from, to, date);
      return d.fxRate(from, to, date);
    },
  };
  return { market, providers: offline ? [d.info, research.info] : [d.info, cg.info, ecb.info, research.info], sourceOf: id => infoFor[src(id)], research };
}

export function lockedError(inst: Instrument) {
  const us = US_MICS.has(inst.exchange);
  return new ApiError(403, 'locked', us
    ? `Live prices for ${inst.symbol} need a data key. Sign in and connect a free Alpaca key in Settings to see real prices, shown only to you.`
    : `Markets doesn't have a free price source for ${inst.symbol} yet. Canadian prices need a licensed feed.`, { reason: us ? 'needs_key' : 'no_source' });
}

/** A user's own Alpaca key serves every US stock and ETF they look at; everything else comes from the shared providers. */
export function withPersonal(base: MarketDataProvider, alpaca: Alpaca): MarketDataProvider {
  const mine = (id: string) => { const i = ENTRIES.get(id)?.inst; return i && (i.assetClass === 'stock' || i.assetClass === 'etf') && US_MICS.has(i.exchange) ? i : null; };
  return {
    ...base,
    info: { ...base.info, provenance: 'production' },
    async quote(id, now) { const i = mine(id); return i ? alpaca.quote(i, now) : base.quote(id, now); },
    async history(id) { const i = mine(id); return i ? alpaca.history(i, new Date()) : base.history(id); },
    async statistics(id, now) { const i = mine(id); if (!i) return base.statistics(id, now); const bars = await alpaca.history(i, now); return alpaca.statistics(i, bars, bars.at(-1) ? `${bars.at(-1)!.date}T21:00:00Z` : null); },
    // No invented dividends, events or statements next to real prices.
    async dividends(id, now) { return mine(id) ? [] : base.dividends(id, now); },
    async events(id, now) { return mine(id) ? [] : base.events(id, now); },
    async financials(id, now) { return mine(id) ? null : base.financials(id, now); },
    async news(id, now) { return id && mine(id) ? [] : base.news(id, now); },
  };
}
