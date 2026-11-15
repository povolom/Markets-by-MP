import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '../lib/router';
import { direction, signedPct, signedMoney, priceFmt, timeAgo, CLASS_LABEL } from '../lib/format';
import type { ApiError } from '../lib/api';

const P: Record<string, string> = {
  overview: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  watchlists: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  portfolio: 'M12 3a9 9 0 1 0 9 9h-9z M14 2.5V10h7.5A9 9 0 0 0 14 2.5z',
  dip: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 12l5-5',
  discover: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20.5 20.5 16 16',
  community: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2.5 20a6.5 6.5 0 0 1 13 0 M16 3.2a4 4 0 0 1 0 7.6 M18 14a6 6 0 0 1 3.5 6',
  plans: 'M4 5h16M4 12h16M4 19h10 M18 17l2 2 3-4',
  calendar: 'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 3 7 3 7H3s3-1 3-7 M10 20a2 2 0 0 0 4 0',
  journal: 'M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z M9 7h6 M9 11h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
  whatif: 'M4 20h16 M6 16l4-6 4 3 5-8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7',
  check: 'M5 12l5 5 9-10', info: 'M12 8h.01M11 12h1v5h1 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6', sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 1v2M12 21v2M1 12h2M21 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z', xray: 'M3 7V4h3 M21 7V4h-3 M3 17v3h3 M21 17v3h-3 M8 12h8 M12 8v8',
};
export function Icon({ name, size = 18, title }: { name: keyof typeof P | string; size?: number; title?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>{title && <title>{title}</title>}<path d={P[name] ?? P.info} /></svg>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return <img src="/icons/logo.png" width={size} height={size} alt="" className="logo-mark" style={{ width: size, height: size }} />;
}
export function Wordmark({ to = '/', beta = true, compact }: { to?: string; beta?: boolean; compact?: boolean }) {
  return <Link to={to} className="wordmark" aria-label="Markets by MP, home"><Logo /><span className="wm-text"><b>markets</b><span>by MP</span></span>{beta && !compact && <span className="badge" style={{ alignSelf: 'center' }}>Beta</span>}</Link>;
}

/** Price change shown with a sign, an arrow and words for screen readers, so colour is never the only cue. */
export function Change({ pct, abs, currency, size }: { pct?: string | null; abs?: string | null; currency?: string; size?: number }) {
  const v = pct ?? abs; const d = direction(v);
  const words = d === 'up' ? 'up' : d === 'down' ? 'down' : 'unchanged';
  return (
    <span className={`change ${d}`} style={size ? { fontSize: size } : undefined}>
      {d !== 'flat' && <Icon name={d} size={size ? size * 0.8 : 13} />}
      <span className="sr-only">{words} </span>
      {abs != null && <span>{signedMoney(abs, currency)}</span>}{abs != null && pct != null && ' '}
      {pct != null && <span>{abs != null ? `(${signedPct(pct)})` : signedPct(pct)}</span>}
    </span>
  );
}

export function Spark({ values, w = 96, h = 30 }: { values: (string | number)[]; w?: number; h?: number }) {
  const v = values.map(Number).filter(Number.isFinite);
  if (v.length < 2) return <span className="faint">—</span>;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (x - min) / span * (h - 4)).toFixed(1)}`).join('');
  const dir = direction(v[v.length - 1] - v[0]);
  return <svg className={`spark ${dir}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`30-day trend: ${dir === 'up' ? 'higher' : dir === 'down' ? 'lower' : 'flat'} (${signedPct(((v[v.length - 1] / v[0]) - 1) * 100)})`}><path d={d} /></svg>;
}

export function Ticker({ symbol }: { symbol: string }) {
  return <span className="tick" aria-hidden>{symbol.replace(/[-.].*/, '').slice(0, 4)}</span>;
}

export function AssetCell({ inst, to = true }: { inst: { id: string; symbol: string; name: string; assetClass?: string; exchange?: string } | null | undefined; to?: boolean }) {
  if (!inst) return <span className="faint">Unknown instrument</span>;
  const body = <><Ticker symbol={inst.symbol} /><span style={{ minWidth: 0 }}><b>{inst.symbol}</b><small>{inst.name}</small></span></>;
  return to ? <Link to={`/assets/${inst.id}`} className="asset-cell">{body}</Link> : <span className="asset-cell">{body}</span>;
}

export function Price({ value, currency }: { value: string | null | undefined; currency?: string }) {
  return <span className="num">{priceFmt(value)}{currency && <span className="faint"> {currency}</span>}</span>;
}

export function DataBadge({ meta }: { meta?: { provenance?: string; observedAt?: string | null } | null }) {
  if (!meta) return null;
  return <span className="row" style={{ gap: 6 }}>{meta.provenance === 'demo' && <span className="badge demo" title="Generated demo data, not real market prices">Demo data</span>}<span className="faint">{meta.observedAt ? `As of ${timeAgo(meta.observedAt)}` : 'Time unknown'}</span></span>;
}

export function ClassLabel({ c }: { c: string }) { return <span className="chip">{CLASS_LABEL[c] ?? c}</span>; }

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="stack-sm" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />)}</div>;
}
export function ErrorState({ error, retry }: { error: ApiError | Error | null; retry?: () => void }) {
  if (!error) return null;
  const status = (error as ApiError).status;
  return (
    <div className="notice warn" role="alert">
      <Icon name="info" />
      <div className="stack-sm"><span>{status === 401 ? 'Sign in to see this.' : error.message}</span>{retry && status !== 401 && <button className="btn sm" onClick={retry}>Try again</button>}</div>
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; prev?.focus(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    set(x => [...x, { id, msg, kind }]);
    setTimeout(() => set(x => x.filter(t => t.id !== id)), 4200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toast-wrap" role="status" aria-live="polite">{items.map(t => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}><Icon name={t.kind === 'err' ? 'info' : 'check'} />{t.msg}</div>)}</div></ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Meter({ pct, muted }: { pct: number; muted?: boolean }) {
  return <div className={`bar-meter ${muted ? 'muted-fill' : ''}`} aria-hidden><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
