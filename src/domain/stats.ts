// Statistics on price series and cash flows. Deterministic, decimal-safe where results are
// authoritative (returns); floats only for dispersion measures that are inherently approximate
// (volatility, correlation), rounded before they leave the server.
import Big from 'big.js';
import { D, pct } from './decimal';
import type { Bar } from './types';

/** Daily simple returns from adjusted closes. */
export function dailyReturns(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = Number(bars[i - 1].adjClose), b = Number(bars[i].adjClose);
    if (a > 0) out.push(b / a - 1);
  }
  return out;
}

/** Annualized volatility in percent (252 trading days; 365 for always-open markets). */
export function annualizedVolatility(returns: number[], periodsPerYear = 252): number | null {
  if (returns.length < 20) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const v = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(v) * Math.sqrt(periodsPerYear) * 100;
}

/** Largest peak-to-trough fall, in percent (negative or 0), plus where it happened. */
export function maxDrawdown(values: { date: string; value: number }[]) {
  let peak = -Infinity, peakDate = '', worst = 0, from = '', to = '';
  for (const p of values) {
    if (p.value > peak) { peak = p.value; peakDate = p.date; }
    const dd = peak > 0 ? (p.value / peak - 1) * 100 : 0;
    if (dd < worst) { worst = dd; from = peakDate; to = p.date; }
  }
  return { pct: worst, from: from || null, to: to || null };
}

/** Pearson correlation of two return series aligned by date. Null if fewer than 30 overlapping days. */
export function correlation(a: Bar[], b: Bar[]): number | null {
  const mapB = new Map<string, number>();
  for (let i = 1; i < b.length; i++) mapB.set(b[i].date, Number(b[i].adjClose) / Number(b[i - 1].adjClose) - 1);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const y = mapB.get(a[i].date);
    if (y === undefined) continue;
    xs.push(Number(a[i].adjClose) / Number(a[i - 1].adjClose) - 1); ys.push(y);
  }
  if (xs.length < 30) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * Time-weighted return (percent) from a daily valuation series with external cash flows.
 * Each sub-period return is (V_end - flow) / V_start, where `flow` is the external flow on that day
 * (positive = money in), assumed to arrive at the end of the day. Linked geometrically.
 */
export function timeWeightedReturn(points: { value: Big; flow: Big }[]): Big | null {
  let growth = D(1), started = false;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1].value, end = points[i].value, flow = points[i].flow;
    if (start.lte(0)) { if (end.gt(0)) started = true; continue; }
    started = true;
    growth = growth.times(end.minus(flow).div(start));
  }
  return started ? growth.minus(1).times(100) : null;
}

/**
 * Money-weighted return (XIRR, annualized percent). `flows` are from the investor's view:
 * contributions negative, withdrawals and the final value positive. Null unless there are at least
 * two dated flows of opposite sign spanning 30+ days, or if it doesn't converge.
 */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null;
  const t0 = Date.parse(flows[0].date);
  const span = (Date.parse(flows[flows.length - 1].date) - t0) / 86400000;
  if (span < 30) return null;
  const years = flows.map(f => (Date.parse(f.date) - t0) / (365 * 86400000));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);
  let lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid * 100;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return ((lo + hi) / 2) * 100;
}

export const fmtPct = (n: number | null) => (n == null || !Number.isFinite(n) ? null : pct(D(n.toFixed(6))));
