// Shared asset search: one hook and one result row, used by the global search, the add-to-watchlist
// dialog and every asset picker, so finding an asset works the same way everywhere.
import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { CLASS_LABEL } from '../lib/format';
import { Change, Price, Ticker } from './ui';

export interface Inst { id: string; symbol: string; name: string; assetClass: string; exchange: string; exchangeName: string; currency: string; tradable: boolean }

/** Debounced search with quotes for the results. Empty query = popular assets. */
export function useAssetSearch(q: string, opts: { limit?: number; tradableOnly?: boolean; quotes?: boolean; enabled?: boolean } = {}) {
  const { limit = 10, tradableOnly, quotes = true, enabled = true } = opts;
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 140); return () => clearTimeout(t); }, [q]);
  const res = useApi<{ data: Inst[] }>(enabled ? `/assets/search?q=${encodeURIComponent(debounced)}&limit=${tradableOnly ? limit + 6 : limit}` : null, [debounced, enabled]);
  const items = (res.data?.data ?? []).filter(i => !tradableOnly || i.tradable).slice(0, limit);
  const ids = items.map(i => i.id).join(',');
  const qs = useApi<{ data: any[] }>(quotes && ids ? `/quotes?ids=${ids}` : null, [ids]);
  const qmap = new Map<string, any>((qs.data?.data ?? []).map(x => [x.instrumentId, x]));
  return { items, qmap, debounced, loading: res.loading || debounced !== q.trim(), error: res.error };
}

const EXCHANGE_SHORT: Record<string, string> = { XNAS: 'Nasdaq', XNYS: 'NYSE', XASE: 'NYSE American', ARCX: 'NYSE Arca', BATS: 'Cboe', XTSE: 'TSX', CRYPTO: 'Crypto', INDEX: 'Index', FX: 'FX', FUND: 'Fund' };
export const exchangeShort = (ex: string) => EXCHANGE_SHORT[ex] ?? ex;

/** Logo, name, ticker line and (optionally) price and today's change. */
export function AssetRowBody({ inst, quote, showQuote = true }: { inst: Inst; quote?: any; showQuote?: boolean }) {
  return (
    <>
      <Ticker symbol={inst.symbol} />
      <span className="ar-main"><b>{inst.name}</b><span className="ar-sub"><span className="ar-sym">{inst.symbol}</span>{exchangeShort(inst.exchange)} · {CLASS_LABEL[inst.assetClass] ?? inst.assetClass}</span></span>
      {showQuote && <span className="ar-quote">{quote ? <><Price value={quote.price} currency={quote.currency} /><span className="row" style={{ gap: 6 }}>{quote.meta?.provenance === 'demo' && <span className="q-demo" title="Generated demo price, not a real market price">Demo</span>}<Change pct={quote.changePct} /></span></> : <span className="skeleton" style={{ width: 64, height: 12 }} />}</span>}
    </>
  );
}

export function NoMatches({ q }: { q: string }) {
  return <div className="empty compact"><h3>No matches for "{q}"</h3><p>Markets covers every US-listed stock and ETF, major TSX listings, the top 250 crypto assets and major currencies. Try the ticker or part of the company name.</p></div>;
}
