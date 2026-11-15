// Buy Plans. A plan is a written intention, never an order. These helpers make the money involved
// clear and stop several plans from silently counting the same available cash.
import Big from 'big.js';
import { D, ZERO, money } from './decimal';

export type PlanMode = 'regular' | 'dip' | 'hybrid';
export interface PlanLevel { dropPct: string; amount: string }
export interface PlanInput {
  id: string; name: string; mode: PlanMode; portfolioId: string | null;
  schedule: 'weekly' | 'biweekly' | 'monthly';
  regularAmount: string; levels: PlanLevel[]; maxTotal: string; currency: string; status: string;
}

const PER_MONTH: Record<string, string> = { weekly: '4.3333', biweekly: '2.1667', monthly: '1' };

/** What a plan could ask for: monthly regular amount, and the most its dip levels could add. */
export function planCommitment(p: PlanInput) {
  const regular = p.mode === 'dip' ? ZERO : D(p.regularAmount).times(D(PER_MONTH[p.schedule]));
  const dipTotal = p.mode === 'regular' ? ZERO : p.levels.reduce((s, l) => s.plus(D(l.amount)), ZERO);
  const limit = D(p.maxTotal);
  return {
    monthlyRegular: money(regular),
    dipLevelsTotal: money(dipTotal),
    personalLimit: limit.gt(0) ? money(limit) : null,
    // The amount set aside for this plan: its limit if it has one, otherwise one month plus all levels.
    reserve: money(limit.gt(0) ? limit : regular.plus(dipTotal)),
  };
}

/**
 * Allocates available cash to active plans in the order given (the user's priority). Each plan gets
 * at most its reserve; nothing is counted twice. Reports any shortfall instead of hiding it.
 */
export function allocateCash(available: string | null, plans: PlanInput[]) {
  const active = plans.filter(p => p.status === 'active');
  if (available == null) {
    return { known: false as const, rows: active.map(p => ({ planId: p.id, reserve: planCommitment(p).reserve, covered: null, shortfall: null })), totalReserve: money(active.reduce((s, p) => s.plus(D(planCommitment(p).reserve)), ZERO)), unallocated: null, overcommitted: null };
  }
  let left = D(available);
  const rows = active.map(p => {
    const reserve = D(planCommitment(p).reserve);
    const covered = left.gte(reserve) ? reserve : left.gt(0) ? left : ZERO;
    left = left.minus(covered);
    return { planId: p.id, reserve: money(reserve), covered: money(covered), shortfall: money(reserve.minus(covered)) };
  });
  const totalReserve = active.reduce((s, p) => s.plus(D(planCommitment(p).reserve)), ZERO);
  return { known: true as const, rows, totalReserve: money(totalReserve), unallocated: money(left.gt(0) ? left : ZERO), overcommitted: totalReserve.gt(D(available)) };
}

/** Which staged levels a current drop has reached (it never adds amounts beyond the plan's levels). */
export function levelsReached(levels: PlanLevel[], dropPct: string | null): PlanLevel[] {
  if (dropPct == null) return [];
  const d = D(dropPct).abs();
  return levels.filter(l => D(dropPct).lt(0) && d.gte(D(l.dropPct)));
}

export function nextReviewDate(from: string, schedule: PlanInput['schedule']): string {
  const d = new Date(from + 'T12:00:00Z');
  if (schedule === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (schedule === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export const isPositive = (v: string) => { try { return new Big(v).gt(0); } catch { return false; } };
