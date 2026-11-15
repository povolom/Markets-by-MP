import { useId, useState } from 'react';
import { useApi } from '../lib/api';
import { CLASS_LABEL } from '../lib/format';
import { Ticker } from './ui';

/** A combobox that searches Markets' coverage. `tradableOnly` hides indexes and FX pairs. */
export function InstrumentPicker({ value, onChange, label = 'Instrument', tradableOnly }: { value: string | null; onChange: (id: string, inst: any) => void; label?: string; tradableOnly?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const id = useId();
  const current = useApi<{ data: any }>(value ? `/assets/${value}` : null, [value]);
  const { data } = useApi<{ data: any[] }>(open ? `/assets/search?q=${encodeURIComponent(q)}&limit=8` : null, [q, open]);
  const items = (data?.data ?? []).filter(i => !tradableOnly || i.tradable);
  const pick = (i: any) => { onChange(i.id, i); setQ(''); setOpen(false); };
  return (
    <div className="field" style={{ position: 'relative', display: 'grid', gap: 6 }}>
      <label htmlFor={id} className="small muted" style={{ fontWeight: 500 }}>{label}</label>
      <input id={id} className="input" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
        placeholder={current.data?.data ? `${current.data.data.symbol} · ${current.data.data.name}` : 'Search by symbol or name'}
        value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQ(e.target.value); setOpen(true); setSel(0); }}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); } if (e.key === 'Enter' && open && items[sel]) { e.preventDefault(); pick(items[sel]); } }} />
      {current.data?.data && !q && <span className="faint">Selected: {current.data.data.symbol} ({CLASS_LABEL[current.data.data.assetClass]}, {current.data.data.currency})</span>}
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="search-results card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 4, marginTop: 4, maxHeight: 280, overflow: 'auto' }}>
          {items.map((i, n) => <li key={i.id} role="option" aria-selected={n === sel}><button type="button" onMouseDown={e => { e.preventDefault(); pick(i); }} style={{ background: n === sel ? 'var(--surface-2)' : undefined }}><Ticker symbol={i.symbol} /><span style={{ flex: 1 }}><b>{i.symbol}</b> <span className="muted small">{i.name}</span></span><span className="faint">{i.currency}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}
