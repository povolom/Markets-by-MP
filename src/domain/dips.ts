// Dip Radar: rule evaluation, threshold crossing, reset and cooldown. Pure functions; the alert job
// (src/server/jobs/alerts.ts) stores the state and events.
//
// Definitions (also published in /developers):
// - Rolling high: the highest value in the last `windowDays` calendar days, including today. With
//   basis "close" it is the highest adjusted close; with basis "intraday" it is the highest daily
//   high (split-adjusted by the same factor as the adjusted close, so splits never look like dips).
// - Drop: (current price - reference) / reference, in percent (negative when below the reference).
// - A rule matches when the drop is at or below -threshold (or the price is at or below the target).
// - Crossing: an alert fires only when an armed rule matches. It then disarms, and re-arms once the
//   price recovers by `resetBand` percentage points past the threshold. A cooldown also limits how
//   often one rule/instrument pair can fire.
import Big from 'big.js';
import { D, maxOf, pct, price as fmtPrice } from './decimal';
import type { Bar } from './types';

export type RuleKind = 'below_rolling_high' | 'below_52w_high' | 'target_price' | 'below_avg_cost' | 'daily_drop' | 'weekly_drop';

export interface RuleInput {
  kind: RuleKind;
  threshold: string;       // percent, or a price for target_price
  windowDays: number;
  basis: 'close' | 'intraday';
  resetBand: string;
  cooldownHours: number;
}

export interface Evaluation {
  matched: boolean;
  metric: string | null;        // drop % (signed) for drop rules, price for target
  reference: string | null;     // the reference high / target / average cost
  referenceDate: string | null;
  recoveredForReset: boolean;   // true when the reset band has been cleared
  explanation: string;
  unavailable?: string;         // why it couldn't be evaluated
}

/** Adjustment factor that puts raw highs on the same basis as adjClose. */
const adj = (b: Bar) => D(b.adjClose).div(D(b.close));

export function referenceHigh(bars: Bar[], asOf: string, windowDays: number, basis: 'close' | 'intraday') {
  const from = new Date(Date.parse(asOf) - (windowDays - 1) * 86400000).toISOString().slice(0, 10);
  const inWindow = bars.filter(b => b.date >= from && b.date <= asOf);
  if (!inWindow.length) return null;
  let best: { value: Big; date: string } | null = null;
  for (const b of inWindow) {
    const v = basis === 'close' ? D(b.adjClose) : D(b.high).times(adj(b));
    if (!best || v.gt(best.value)) best = { value: v, date: b.date };
  }
  return best;
}

export function evaluateRule(rule: RuleInput, bars: Bar[], currentPrice: string, avgCost: string | null): Evaluation {
  const t = D(rule.threshold), band = D(rule.resetBand), p = D(currentPrice);
  const last = bars[bars.length - 1];
  if (!last) return { matched: false, metric: null, reference: null, referenceDate: null, recoveredForReset: false, explanation: '', unavailable: 'No price history is available.' };
  const asOf = last.date;

  const dropRule = (ref: Big, refDate: string | null, label: string): Evaluation => {
    const drop = p.minus(ref).div(ref).times(100);
    const matched = drop.lte(t.times(-1));
    return {
      matched, metric: pct(drop), reference: fmtPrice(ref), referenceDate: refDate,
      recoveredForReset: drop.gt(t.minus(band).times(-1)),
      explanation: `${pct(drop.abs())}% ${drop.lt(0) ? 'below' : 'above'} ${label}`,
    };
  };

  switch (rule.kind) {
    case 'below_rolling_high':
    case 'below_52w_high': {
      const days = rule.kind === 'below_52w_high' ? 365 : rule.windowDays;
      const ref = referenceHigh(bars, asOf, days, rule.basis);
      if (!ref) return { matched: false, metric: null, reference: null, referenceDate: null, recoveredForReset: false, explanation: '', unavailable: 'Not enough history for this window.' };
      // Put the adjusted reference back on today's price basis before comparing with the live price.
      const refToday = { value: ref.value.div(adj(last)), date: ref.date };
      const r = refToday.value.gt(p) ? refToday : { value: maxOf([refToday.value, p])!, date: asOf };
      return dropRule(r.value, r.date, `its ${days}-day ${rule.basis === 'close' ? 'closing' : 'intraday'} high`);
    }
    case 'target_price': {
      const matched = p.lte(t);
      return { matched, metric: fmtPrice(p), reference: fmtPrice(t), referenceDate: null, recoveredForReset: p.gte(t.times(D(1).plus(band.div(100)))), explanation: matched ? `At or below your target price of ${fmtPrice(t)}` : `${pct(p.minus(t).div(t).times(100))}% above your target price` };
    }
    case 'below_avg_cost': {
      if (avgCost == null) return { matched: false, metric: null, reference: null, referenceDate: null, recoveredForReset: false, explanation: '', unavailable: 'This holding has no known average cost.' };
      return dropRule(D(avgCost), null, 'your average cost');
    }
    case 'daily_drop': {
      const prev = bars.length >= 2 ? D(bars[bars.length - 2].adjClose).div(adj(last)) : null;
      if (!prev) return { matched: false, metric: null, reference: null, referenceDate: null, recoveredForReset: false, explanation: '', unavailable: 'No previous close.' };
      return dropRule(prev, bars[bars.length - 2].date, 'the previous close');
    }
    case 'weekly_drop': {
      const ago = bars.length >= 6 ? bars[bars.length - 6] : null;
      if (!ago) return { matched: false, metric: null, reference: null, referenceDate: null, recoveredForReset: false, explanation: '', unavailable: 'Not enough history.' };
      return dropRule(D(ago.adjClose).div(adj(last)), ago.date, 'the close 5 trading days ago');
    }
  }
}

export interface AlertState { armed: boolean; lastTriggeredAt: string | null }

/** Decides whether to fire, and the next state. Pure: callers persist `next`. */
export function step(state: AlertState, ev: Evaluation, rule: RuleInput, now: Date): { fire: boolean; next: AlertState; suppressedBy?: 'cooldown' | 'disarmed' } {
  if (ev.unavailable) return { fire: false, next: state };
  if (!state.armed) {
    return ev.recoveredForReset ? { fire: false, next: { ...state, armed: true } } : { fire: false, next: state, suppressedBy: ev.matched ? 'disarmed' : undefined };
  }
  if (!ev.matched) return { fire: false, next: state };
  const cooling = state.lastTriggeredAt && now.getTime() - Date.parse(state.lastTriggeredAt) < rule.cooldownHours * 3600000;
  if (cooling) return { fire: false, next: { ...state, armed: false }, suppressedBy: 'cooldown' };
  return { fire: true, next: { armed: false, lastTriggeredAt: now.toISOString() } };
}

/** One alert per rule, instrument and market date, however many times the job runs. */
export const dedupeKey = (ruleId: string, instrumentId: string, marketDate: string) => `${ruleId}:${instrumentId}:${marketDate}`;
