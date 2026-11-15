import { useEffect, useId, useRef, useState } from 'react';
import { useApi } from '../lib/api';
import { AssetRowBody, NoMatches, useAssetSearch, type Inst } from './AssetSearch';
import { Icon } from './ui';

/** Choose one asset. Shows the chosen asset as a card with a Change button; searching opens inline
 * results with prices. `tradableOnly` hides indexes and currency pairs. */
export function InstrumentPicker({ value, onChange, label = 'Asset', tradableOnly }: { value: string | null; onChange: (id: string, inst: any) => void; label?: string; tradableOnly?: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState(!value);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const current = useApi<{ data: Inst }>(value ? `/assets/${value}` : null, [value]);
  const quote = useApi<{ data: any[] }>(value && !editing ? `/quotes?ids=${value}` : null, [value, editing]);
  const { items, qmap, debounced, loading } = useAssetSearch(q, { limit: 6, tradableOnly, enabled: editing });
  useEffect(() => { if (!value) setEditing(true); }, [value]);
  const pick = (i: Inst) => { onChange(i.id, i); setQ(''); setEditing(false); };
  const startEditing = () => { setEditing(true); setTimeout(() => input.current?.focus(), 0); };

  return (
    <div className="picker">
      <span className="picker-label" id={`${id}-label`}>{label}</span>
      {!editing && current.data?.data ? (
        <div className="picked" aria-labelledby={`${id}-label`}>
          <AssetRowBody inst={current.data.data} quote={quote.data?.data?.[0]} />
          <button type="button" className="btn sm" onClick={startEditing} aria-label={`Change ${label.toLowerCase()}`}>Change</button>
        </div>
      ) : (
        <div className="picker-search">
          <div className="search-box">
            <Icon name="discover" size={17} />
            <input ref={input} autoFocus={Boolean(value)} role="combobox" aria-expanded aria-controls={`${id}-list`} aria-labelledby={`${id}-label`} autoComplete="off" spellCheck={false}
              placeholder="Search a company, ticker or crypto" value={q}
              onChange={e => { setQ(e.target.value); setSel(0); }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
                if (e.key === 'Enter' && items[sel]) { e.preventDefault(); pick(items[sel]); }
                if (e.key === 'Escape' && value) { e.stopPropagation(); setEditing(false); }
              }} />
            {value && <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
          <ul id={`${id}-list`} role="listbox" className="results" aria-label="Matching assets">
            {!debounced && <li className="results-cap" role="presentation">Popular</li>}
            {items.map((i, n) => (
              <li key={i.id} role="option" aria-selected={n === sel}>
                <button type="button" className={`result ${n === sel ? 'active' : ''}`} onMouseEnter={() => setSel(n)} onClick={() => pick(i)}><AssetRowBody inst={i} quote={qmap.get(i.id)} /></button>
              </li>
            ))}
            {!loading && debounced && !items.length && <li role="presentation"><NoMatches q={debounced} /></li>}
          </ul>
        </div>
      )}
    </div>
  );
}
