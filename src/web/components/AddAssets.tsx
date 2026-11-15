import { useEffect, useState } from 'react';
import { api, useApi } from '../lib/api';
import { CLASS_LABEL } from '../lib/format';
import { Change, Dialog, Icon, Price, Ticker, useToast } from './ui';

/** Search by company name, nickname or ticker and add several results without leaving the dialog. */
export function AddAssets({ list, onClose, onChanged }: { list: { id: string; name: string; items: { instrumentId: string }[] }; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const [added, setAdded] = useState<Set<string>>(() => new Set(list.items.map(i => i.instrumentId)));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 150); return () => clearTimeout(t); }, [q]);
  const res = useApi<{ data: any[] }>(`/assets/search?q=${encodeURIComponent(debounced)}&limit=10`, [debounced]);
  const items = res.data?.data ?? [];
  const quotes = useApi<{ data: any[] }>(items.length ? `/quotes?ids=${items.map(i => i.id).join(',')}` : null, [items.map(i => i.id).join(',')]);
  const qmap = new Map((quotes.data?.data ?? []).map(x => [x.instrumentId, x]));
  const toggle = async (inst: any) => {
    setBusy(inst.id);
    try {
      if (added.has(inst.id)) { await api.del(`/watchlists/${list.id}/items/${inst.id}`); setAdded(s => { const n = new Set(s); n.delete(inst.id); return n; }); }
      else { await api.post(`/watchlists/${list.id}/items`, { instrumentId: inst.id }); setAdded(s => new Set(s).add(inst.id)); toast(`${inst.symbol} added to ${list.name}.`); }
      onChanged();
    } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(null); }
  };
  return (
    <Dialog title={`Add to ${list.name}`} onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="search-box">
        <Icon name="discover" size={18} />
        <input autoFocus value={q} placeholder="Company, ticker or nickname, e.g. Apple, RY, google, bitcoin" aria-label="Search for an asset" aria-controls="add-results"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); } if (e.key === 'Enter' && items[sel]) { e.preventDefault(); void toggle(items[sel]); } }} />
        {q && <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
      </div>
      <p className="faint">{debounced ? `${items.length ? 'Best matches' : 'No matches'} for "${debounced}"` : 'Popular in Markets\' coverage'} · Enter adds the highlighted result</p>
      <ul className="add-results" id="add-results" role="listbox" aria-label="Results">
        {items.map((i, n) => {
          const qt = qmap.get(i.id); const has = added.has(i.id);
          return (
            <li key={i.id} role="option" aria-selected={n === sel} className={n === sel ? 'active' : ''} onMouseEnter={() => setSel(n)}>
              <Ticker symbol={i.symbol} />
              <div className="grow"><b>{i.name}</b><div className="faint">{i.symbol} · {i.exchange} · {CLASS_LABEL[i.assetClass]}</div></div>
              <div className="r hide-m">{qt ? <><Price value={qt.price} currency={qt.currency} /><div><Change pct={qt.changePct} /></div></> : null}</div>
              <button className={`btn sm ${has ? '' : 'primary'}`} disabled={busy === i.id} onClick={() => toggle(i)} aria-label={has ? `Remove ${i.symbol}` : `Add ${i.symbol}`}>{has ? <><Icon name="check" size={14} />Added</> : <><Icon name="plus" size={14} />Add</>}</button>
            </li>
          );
        })}
      </ul>
      {debounced && !items.length && <div className="notice"><Icon name="info" /><span>Markets' beta covers about 130 stocks, ETFs, crypto assets, indexes and currencies. Try the ticker, or a shorter part of the name.</span></div>}
    </Dialog>
  );
}
