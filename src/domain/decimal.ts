// Decimal-safe money and quantity maths. All authoritative calculations go through big.js
// (never JavaScript floats) and values cross the API as decimal strings.
import Big from 'big.js';

Big.DP = 20;
Big.RM = Big.roundHalfEven;

export type Dec = Big;
export const D = (v: string | number | Big | null | undefined): Big => new Big(v == null || v === '' ? 0 : v);
export const isDec = (v: unknown): boolean => {
  if (v == null || v === '') return false;
  try { new Big(v as string); return true; } catch { return false; }
};
export const ZERO = new Big(0);

/** Round for display/transport. Money 2 dp, prices 4 dp, quantities 8 dp, percentages 2 dp. */
export const money = (v: Big) => v.round(2).toFixed(2);
export const price = (v: Big) => v.round(4).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1');
export const qty = (v: Big) => v.round(8).toString();
export const pct = (v: Big) => v.round(2).toFixed(2);

export function sum(values: Big[]): Big {
  return values.reduce((a, b) => a.plus(b), ZERO);
}

/** Percent change from `from` to `to`, or null when `from` is zero (undefined, not zero). */
export function pctChange(from: Big, to: Big): Big | null {
  if (from.eq(0)) return null;
  return to.minus(from).div(from).times(100);
}

export function maxOf(values: Big[]): Big | null {
  return values.length ? values.reduce((a, b) => (b.gt(a) ? b : a)) : null;
}
export function minOf(values: Big[]): Big | null {
  return values.length ? values.reduce((a, b) => (b.lt(a) ? b : a)) : null;
}
