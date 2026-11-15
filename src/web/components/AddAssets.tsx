import { useState } from 'react';
import { api } from '../lib/api';
import { AssetRowBody, NoMatches, useAssetSearch } from './AssetSearch';
import { Dialog, Icon, useToast } from './ui';

/** Search by company name, nickname or ticker and add several results without leaving the dialog. */
export function AddAssets({ list, onClose, onChanged }: { list: { id: string; name: string; items: { instrumentId: string }[] }; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [added, setAdded] = useState<Set<string>>(() => new Set(list.items.map(i => i.instrumentId)));
  const [busy, setBusy] = useState<string | null>(null);
  const { items, qmap, debounced, loading } = useAssetSearch(q, { limit: 10 });
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
        <input autoFocus value={q} placeholder="Search a company, ticker or crypto, e.g. Apple, RY, bitcoin" aria-label="Search for an asset" aria-controls="add-results"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); } if (e.key === 'Enter' && items[sel]) { e.preventDefault(); void toggle(items[sel]); } }} />
        {q && <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
      </div>
      <ul className="results" id="add-results" role="listbox" aria-label="Results">
        <li className="results-cap" role="presentation">{debounced ? 'Best matches' : 'Popular'}<span className="hide-m"> · Enter adds the highlighted result</span></li>
        {items.map((i, n) => {
          const qt = qmap.get(i.id); const has = added.has(i.id);
          return (
            <li key={i.id} role="option" aria-selected={n === sel} className={`result ${n === sel ? 'active' : ''}`} onMouseEnter={() => setSel(n)}>
              <AssetRowBody inst={i} quote={qt} />
              <button className={`btn sm ${has ? '' : 'primary'}`} disabled={busy === i.id} onClick={() => toggle(i)} aria-label={has ? `Remove ${i.symbol}` : `Add ${i.symbol}`}>{has ? <><Icon name="check" size={14} />Added</> : <><Icon name="plus" size={14} />Add</>}</button>
            </li>
          );
        })}
      </ul>
      {!loading && debounced && !items.length && <NoMatches q={debounced} />}
    </Dialog>
  );
}
