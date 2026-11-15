// What-If Portfolio: applies one hypothetical trade or contribution to a copy of the current holdings
// and reports what would change. Nothing here touches the stored transactions.
import Big from 'big.js';
import { D, ZERO, money, pct, price as fmtPrice } from './decimal';
import { exposures, type Composition, type Lookup, type Position } from './exposure';
import type { Holding } from './portfolio';

export interface WhatIfAction {
  type: 'buy' | 'sell' | 'contribute';
  instrumentId?: string;
  quantity?: string;           // buy/sell by units
  amount?: string;             // buy by amount (base currency) or contribution amount
  price: string;               // assumed price, instrument currency
  fxToBase: string;            // assumed rate instrument currency -> base
  fee: string;                 // base currency
  funding: 'cash' | 'new_money'; // buy: spend existing cash or add new money first
}

export interface WhatIfInput {
  holdings: Pick<Holding, 'instrumentId' | 'quantity' | 'marketValue' | 'avgCost' | 'costKnown' | 'price'>[];
  cash: string | null;
  action: WhatIfAction;
  dividendYieldPct: (id: string) => string | null; // trailing yield, percent
}

export function whatIf(input: WhatIfInput, inst: Lookup, comp: Composition) {
  const a = input.action;
  const fx = D(a.fxToBase), px = D(a.price), fee = D(a.fee || 0);
  const assumptions = [
    a.instrumentId ? `Price ${fmtPrice(px)} ${inst(a.instrumentId)?.currency ?? ''} per unit` : null,
    a.fxToBase !== '1' ? `Exchange rate ${a.fxToBase}` : null,
    `Fee ${money(fee)}`,
    a.type === 'buy' ? (a.funding === 'cash' ? 'Paid from existing cash' : 'Paid with new money added first') : null,
  ].filter(Boolean) as string[];
  const warnings: string[] = [];

  const before = new Map<string, { qty: Big; value: Big; avg: Big | null }>();
  for (const h of input.holdings) before.set(h.instrumentId, { qty: D(h.quantity), value: D(h.marketValue), avg: h.costKnown && h.avgCost ? D(h.avgCost) : null });
  const after = new Map([...before].map(([k, v]) => [k, { ...v }]));
  const cashBefore = input.cash == null ? null : D(input.cash);
  let cashAfter = cashBefore, newMoney = ZERO;

  if (a.type === 'contribute') {
    const amt = D(a.amount);
    newMoney = amt; cashAfter = (cashBefore ?? ZERO).plus(amt);
  } else if (a.instrumentId) {
    const id = a.instrumentId;
    const units = a.quantity ? D(a.quantity) : D(a.amount).minus(fee).div(px.times(fx));
    const gross = units.times(px).times(fx);
    const cur = after.get(id) ?? { qty: ZERO, value: ZERO, avg: ZERO };
    if (a.type === 'buy') {
      const cost = gross.plus(fee);
      if (a.funding === 'new_money') { newMoney = cost; cashAfter = cashBefore; }
      else {
        if (cashBefore == null) warnings.push('Your cash balance is unknown, so this assumes the cash is available.');
        else if (cashBefore.lt(cost)) warnings.push(`This costs ${money(cost)}, more than your ${money(cashBefore)} cash.`);
        cashAfter = (cashBefore ?? ZERO).minus(cost);
      }
      const qty = cur.qty.plus(units);
      const avg = cur.avg && qty.gt(0) ? cur.avg.times(cur.qty).plus(cost).div(qty) : (cur.qty.eq(0) ? cost.div(qty) : null);
      after.set(id, { qty, value: cur.value.plus(gross), avg });
    } else {
      if (units.gt(cur.qty)) warnings.push('You can\'t sell more units than you hold; the sale was capped at your position.');
      const sold = units.gt(cur.qty) ? cur.qty : units;
      const proceeds = sold.times(px).times(fx).minus(fee);
      cashAfter = (cashBefore ?? ZERO).plus(proceeds);
      const left = cur.qty.minus(sold);
      after.set(id, { qty: left, value: cur.qty.gt(0) ? cur.value.times(left).div(cur.qty) : ZERO, avg: cur.avg });
    }
  }

  const toPositions = (m: Map<string, { value: Big }>): Position[] => [...m].filter(([, v]) => v.value.gt(0)).map(([instrumentId, v]) => ({ instrumentId, value: v.value }));
  const expBefore = exposures(toPositions(before), cashBefore, inst, comp);
  const expAfter = exposures(toPositions(after), cashAfter && cashAfter.gt(0) ? cashAfter : null, inst, comp);
  const income = (m: Map<string, { value: Big }>) => {
    let total = ZERO, unknown = 0;
    for (const [id, v] of m) { const y = input.dividendYieldPct(id); if (y == null) { if (v.value.gt(0)) unknown++; continue; } total = total.plus(v.value.times(D(y)).div(100)); }
    return { annual: money(total), holdingsWithoutYield: unknown };
  };
  const ids = new Set([...before.keys(), ...after.keys()]);
  const totalB = D(expBefore.totalValue), totalA = D(expAfter.totalValue);
  const rows = [...ids].map(id => {
    const b = before.get(id), x = after.get(id);
    return {
      instrumentId: id,
      weightBefore: b && totalB.gt(0) ? pct(b.value.div(totalB).times(100)) : '0.00',
      weightAfter: x && totalA.gt(0) ? pct(x.value.div(totalA).times(100)) : '0.00',
      quantityAfter: x ? x.qty.round(8).toString() : '0',
      avgCostBefore: b?.avg ? fmtPrice(b.avg) : null,
      avgCostAfter: x?.avg ? fmtPrice(x.avg) : null,
    };
  }).sort((p, q) => Number(q.weightAfter) - Number(p.weightAfter));

  return {
    assumptions, warnings,
    newMoney: money(newMoney),
    cashBefore: cashBefore ? money(cashBefore) : null,
    cashAfter: cashAfter ? money(cashAfter) : null,
    holdings: rows,
    before: expBefore, after: expAfter,
    estimatedAnnualDividends: { before: income(before), after: income(after), note: 'Trailing yield times value. An estimate, not a forecast; dividends can change or stop.' },
  };
}
