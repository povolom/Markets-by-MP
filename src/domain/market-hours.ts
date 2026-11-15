// Market sessions by exchange timezone. Holidays are not modelled in the beta (documented in
// /api/v1/coverage); weekends and regular/extended hours are.
import type { AssetClass, SessionStatus } from './types';

interface Hours { tz: string; pre?: [number, number]; open: [number, number]; close: [number, number]; post?: [number, number] }

const HOURS: Record<string, Hours> = {
  XNAS: { tz: 'America/New_York', pre: [4, 0], open: [9, 30], close: [16, 0], post: [20, 0] },
  XNYS: { tz: 'America/New_York', pre: [4, 0], open: [9, 30], close: [16, 0], post: [20, 0] },
  ARCX: { tz: 'America/New_York', pre: [4, 0], open: [9, 30], close: [16, 0], post: [20, 0] },
  XTSE: { tz: 'America/Toronto', open: [9, 30], close: [16, 0] },
  FUND: { tz: 'America/Toronto', open: [9, 30], close: [16, 0] },
  INDEX: { tz: 'America/New_York', open: [9, 30], close: [16, 0] },
};

/** Local wall-clock parts of `at` in `tz`. */
const formatters = new Map<string, Intl.DateTimeFormat>(); // building a formatter is expensive; reuse one per zone
export function localParts(at: Date, tz: string) {
  let f = formatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }); formatters.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday as string };
}

export function sessionStatus(exchange: string, assetClass: AssetClass, at: Date): SessionStatus {
  if (assetClass === 'crypto') return 'always_open';
  if (assetClass === 'fx') {
    // FX trades around the clock on weekdays (Sunday 17:00 to Friday 17:00 New York).
    const { weekday, hour } = localParts(at, 'America/New_York');
    if (weekday === 'Sat' || (weekday === 'Sun' && hour < 17) || (weekday === 'Fri' && hour >= 17)) return 'closed';
    return 'open';
  }
  const h = HOURS[exchange] ?? HOURS.XNYS;
  const { weekday, hour, minute } = localParts(at, h.tz);
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';
  const m = hour * 60 + minute, mins = (x: [number, number]) => x[0] * 60 + x[1];
  if (m >= mins(h.open) && m < mins(h.close)) return 'open';
  if (h.pre && m >= mins(h.pre) && m < mins(h.open)) return 'pre';
  if (h.post && m >= mins(h.close) && m < mins(h.post)) return 'post';
  return 'closed';
}

export function exchangeTimezone(exchange: string, assetClass: AssetClass): string {
  if (assetClass === 'crypto') return 'UTC';
  if (assetClass === 'fx') return 'America/New_York';
  return (HOURS[exchange] ?? HOURS.XNYS).tz;
}

/** The most recent completed or current trading date (YYYY-MM-DD) for an exchange at `at`. */
export function lastTradingDate(exchange: string, assetClass: AssetClass, at: Date): string {
  const tz = exchangeTimezone(exchange, assetClass);
  let d = new Date(at);
  for (let i = 0; i < 7; i++) {
    const { date, weekday } = localParts(d, tz);
    if (assetClass === 'crypto' || (weekday !== 'Sat' && weekday !== 'Sun')) return date;
    d = new Date(d.getTime() - 86400000);
  }
  return localParts(at, tz).date;
}
