// Display formatting. Values arrive as decimal strings and are only formatted here, never re-calculated.
const nf = (min: number, max: number) => new Intl.NumberFormat('en-CA', { minimumFractionDigits: min, maximumFractionDigits: max });

export function money(v: string | number | null | undefined, currency?: string, opts: { compact?: boolean } = {}) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (opts.compact && Math.abs(n) >= 1e6) return `${currency ? currency + ' ' : ''}${new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;
  return `${currency ? currency + ' ' : ''}${nf(2, 2).format(n)}`;
}

export function priceFmt(v: string | number | null | undefined) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Math.abs(n) >= 10 ? nf(2, 2).format(n) : Math.abs(n) >= 1 ? nf(2, 4).format(n) : Math.abs(n) >= 0.01 ? nf(2, 6).format(n) : nf(2, 10).format(n);
}

/** Signed percent with an explicit + or − so direction never depends on colour. */
export function signedPct(v: string | number | null | undefined) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(2, 2).format(Math.abs(n))}%`;
}
export function signedMoney(v: string | number | null | undefined, currency?: string) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${currency ? currency + ' ' : ''}${nf(2, 2).format(Math.abs(n))}`;
}
export const direction = (v: string | number | null | undefined) => (v == null || v === '' ? 'flat' : Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

export function dateFmt(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(d + 'T12:00:00Z') : new Date(d);
  return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: d.length === 10 ? 'UTC' : undefined }).format(date);
}
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'unknown time';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return dateFmt(iso);
}
export const SESSION_LABEL: Record<string, string> = { open: 'Market open', pre: 'Pre-market', post: 'After hours', closed: 'Market closed', always_open: 'Trades 24/7' };
export const CLASS_LABEL: Record<string, string> = { stock: 'Stock', etf: 'ETF', crypto: 'Crypto', index: 'Index', fx: 'Currency', mutual_fund: 'Mutual fund' };

/** Display symbol from a Markets ID ("xnys.brk.b" -> "BRK.B"). Prefer the instrument's own symbol when you have it. */
export const symbolOf = (id: string | null | undefined) => (id ? id.slice(id.indexOf('.') + 1).toUpperCase() : '');
