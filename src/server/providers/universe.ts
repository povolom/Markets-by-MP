// Every instrument Markets knows about: the generated listing universe (US and Canadian stocks and ETFs,
// top crypto, FX pairs) merged with the curated catalogue, which adds sectors, descriptions and the
// richer demo profiles. Parsed once at module load, which Workers runs at startup, not per request.
import type { Instrument } from '../../domain/types';
import { UNIVERSE } from '../data/universe.gen';
import { SEEDS, toInstrument } from './demo-catalogue';

export type Source = 'demo' | 'coingecko' | 'ecb';

export interface Entry { inst: Instrument; rank: number; source: Source; coingeckoId?: string; curated: boolean }

const EX: Record<string, { mic: string; name: string; ccy: string; country: string | null; tz: string }> = {
  Q: { mic: 'XNAS', name: 'Nasdaq', ccy: 'USD', country: 'US', tz: 'America/New_York' },
  N: { mic: 'XNYS', name: 'New York Stock Exchange', ccy: 'USD', country: 'US', tz: 'America/New_York' },
  A: { mic: 'XASE', name: 'NYSE American', ccy: 'USD', country: 'US', tz: 'America/New_York' },
  P: { mic: 'ARCX', name: 'NYSE Arca', ccy: 'USD', country: 'US', tz: 'America/New_York' },
  Z: { mic: 'BATS', name: 'Cboe BZX', ccy: 'USD', country: 'US', tz: 'America/New_York' },
  T: { mic: 'XTSE', name: 'Toronto Stock Exchange', ccy: 'CAD', country: 'CA', tz: 'America/Toronto' },
};

const sourceFor = (cls: Instrument['assetClass']): Source => cls === 'crypto' ? 'coingecko' : cls === 'fx' ? 'ecb' : 'demo';

function build() {
  const byId = new Map<string, Entry>();
  const curatedSymbols = new Set<string>();
  for (const s of SEEDS) {
    const inst = toInstrument(s);
    byId.set(inst.id, { inst, rank: 1, source: sourceFor(inst.assetClass), curated: true });
    curatedSymbols.add(`${inst.country}|${inst.symbol}`);
  }
  for (const line of UNIVERSE.split('\n')) {
    const [ex, symbol, name, cls, rankS, extra] = line.split('|');
    const rank = Number(rankS) || 5;
    if (cls === 'c') {
      const id = `crypto.${symbol.toLowerCase()}-usd`;
      const prev = byId.get(id);
      if (prev) { prev.coingeckoId = extra; continue; }
      byId.set(id, { inst: { id, symbol: `${symbol}-USD`, name, assetClass: 'crypto', exchange: 'CRYPTO', exchangeName: 'Crypto (24/7, composite)', currency: 'USD', timezone: 'UTC', country: null, sector: null, industry: null, tradable: true, description: `${name} (${symbol}), priced in US dollars.` }, rank: rank <= 20 ? 1 : rank <= 100 ? 2 : 3, source: 'coingecko', coingeckoId: extra, curated: false });
      continue;
    }
    if (cls === 'x') {
      const id = `fx.${symbol.toLowerCase()}`;
      if (byId.has(id)) continue;
      const base = symbol.slice(0, 3), quote = symbol.slice(3);
      byId.set(id, { inst: { id, symbol, name, assetClass: 'fx', exchange: 'FX', exchangeName: 'Foreign exchange', currency: quote, timezone: 'America/New_York', country: null, sector: null, industry: null, tradable: false, description: `${quote} per ${base}. European Central Bank reference rate.` }, rank: 2, source: 'ecb', curated: false });
      continue;
    }
    const e = EX[ex]; if (!e) continue;
    if (curatedSymbols.has(`${e.country}|${symbol}`)) continue;
    const id = `${e.mic.toLowerCase()}.${symbol.toLowerCase()}`;
    if (byId.has(id)) continue;
    const etf = cls === 'e';
    byId.set(id, { inst: { id, symbol, name, assetClass: etf ? 'etf' : 'stock', exchange: e.mic, exchangeName: e.name, currency: e.ccy, timezone: e.tz, country: e.country, sector: null, industry: null, tradable: true, description: etf ? `Exchange-traded fund listed on ${e.name}.` : `Listed on ${e.name}.` }, rank: rank + 1, source: 'demo', curated: false });
  }
  return byId;
}

export const ENTRIES = build();
export const INSTRUMENTS: Instrument[] = [...ENTRIES.values()].map(e => e.inst);
/** The curated set: used where scanning everything would be too slow (screeners, "similar"). */
export const FEATURED: Instrument[] = [...ENTRIES.values()].filter(e => e.curated).map(e => e.inst);
export const rankOf = (id: string) => ENTRIES.get(id)?.rank ?? 9;
