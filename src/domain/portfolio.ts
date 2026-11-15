// Portfolio accounting. Builds holdings, cash, income and gains from the transaction record using the
// average-cost method (as used for Canadian adjusted cost base). Everything is converted to the
// portfolio's base currency at the trade-date FX rate stored on each transaction; current values use
// the current FX rate. Anything that can't be known from the record is returned as null with a reason,
// never as zero.
import Big from 'big.js';
import { D, ZERO, money, price as fmtPrice, qty as fmtQty, pct, sum } from './decimal';
import type { Transaction } from './types';

export interface PriceInput { price: string; currency: string; asOf: string | null }

export interface Holding {
  instrumentId: string;
  quantity: string;
  currency: string;
  avgCost: string | null;          // per unit, in base currency
  costBasis: string | null;        // base currency
  costKnown: boolean;
  price: string | null;            // current, instrument currency
  marketValue: string | null;      // base currency
  unrealizedGain: string | null;
  unrealizedGainPct: string | null;
  realizedGain: string | null;
  income: string;                  // dividends received, base
  weightPct: string | null;        // of total portfolio value
  priceAsOf: string | null;
}

export interface PortfolioSummary {
  baseCurrency: string;
  holdings: Holding[];
  cash: string | null;             // null when an unknown-price trade makes cash unknowable
  holdingsValue: string | null;
  totalValue: string | null;
  netContributions: string;        // deposits - withdrawals, as recorded
  contributionsRecorded: boolean;
  realizedGain: string | null;
  unrealizedGain: string | null;
  income: string;
  fees: string;
  investmentGain: string | null;   // total value - net contributions (needs recorded contributions)
  warnings: string[];
}

interface Pos { qty: Big; cost: Big; costKnown: boolean; realized: Big; realizedKnown: boolean; income: Big; currency: string }

export function sortTransactions(txs: Transaction[]): Transaction[] {
  const order: Record<string, number> = { deposit: 0, split: 1, buy: 2, sell: 3, dividend: 4, interest: 5, fee: 6, withdrawal: 7 };
  return [...txs].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || order[a.type] - order[b.type]);
}

/** Converts an amount in `currency` to base with the transaction's stored rate. */
function toBase(amount: Big, tx: Transaction, base: string, warnings: Set<string>, fxNow: (c: string) => Big | null): Big {
  if (tx.currency === base) return amount;
  if (tx.fxToBase) return amount.times(D(tx.fxToBase));
  const now = fxNow(tx.currency);
  warnings.add(`Some ${tx.currency} transactions had no trade-date exchange rate, so today's rate was used for them.`);
  return amount.times(now ?? 1);
}

export function buildPortfolio(
  transactions: Transaction[],
  baseCurrency: string,
  prices: Record<string, PriceInput | undefined>,
  fxNow: (currency: string) => Big | null,   // currency -> base, current
): PortfolioSummary {
  const warnings = new Set<string>();
  const pos = new Map<string, Pos>();
  let cash = ZERO, cashKnown = true, deposits = ZERO, withdrawals = ZERO, fees = ZERO, income = ZERO;
  let contributionsRecorded = false;

  const get = (tx: Transaction) => {
    const id = tx.instrumentId!;
    let p = pos.get(id);
    if (!p) { p = { qty: ZERO, cost: ZERO, costKnown: true, realized: ZERO, realizedKnown: true, income: ZERO, currency: tx.currency }; pos.set(id, p); }
    return p;
  };

  for (const tx of sortTransactions(transactions)) {
    const fee = toBase(D(tx.fee || 0), tx, baseCurrency, warnings, fxNow);
    switch (tx.type) {
      case 'deposit': { const a = toBase(D(tx.amount), tx, baseCurrency, warnings, fxNow); cash = cash.plus(a); deposits = deposits.plus(a); contributionsRecorded = true; break; }
      case 'withdrawal': { const a = toBase(D(tx.amount), tx, baseCurrency, warnings, fxNow); cash = cash.minus(a); withdrawals = withdrawals.plus(a); contributionsRecorded = true; break; }
      case 'fee': { const a = toBase(D(tx.amount), tx, baseCurrency, warnings, fxNow); cash = cash.minus(a); fees = fees.plus(a); break; }
      case 'interest': { const a = toBase(D(tx.amount), tx, baseCurrency, warnings, fxNow); cash = cash.plus(a); income = income.plus(a); break; }
      case 'dividend': {
        const a = toBase(D(tx.amount), tx, baseCurrency, warnings, fxNow);
        cash = cash.plus(a); income = income.plus(a);
        if (tx.instrumentId) get(tx).income = get(tx).income.plus(a);
        break;
      }
      case 'split': {
        const p = get(tx); const ratio = D(tx.quantity);
        if (ratio.lte(0)) { warnings.add(`A split on ${tx.tradeDate} has an invalid ratio and was ignored.`); break; }
        p.qty = p.qty.times(ratio); // cost basis is unchanged by a split
        break;
      }
      case 'buy': {
        const p = get(tx); const q = D(tx.quantity);
        p.qty = p.qty.plus(q);
        fees = fees.plus(fee);
        if (tx.price == null) { p.costKnown = false; cashKnown = false; break; }
        const cost = toBase(q.times(D(tx.price)), tx, baseCurrency, warnings, fxNow).plus(fee);
        p.cost = p.cost.plus(cost); cash = cash.minus(cost);
        break;
      }
      case 'sell': {
        const p = get(tx); const q = D(tx.quantity);
        fees = fees.plus(fee);
        if (q.gt(p.qty)) warnings.add(`A sale on ${tx.tradeDate} is larger than the recorded position; earlier buys may be missing.`);
        const sold = q.gt(p.qty) ? p.qty : q;
        if (tx.price == null) { cashKnown = false; p.realizedKnown = false; }
        const proceeds = tx.price == null ? null : toBase(q.times(D(tx.price)), tx, baseCurrency, warnings, fxNow).minus(fee);
        if (proceeds) cash = cash.plus(proceeds);
        if (p.costKnown && proceeds && p.qty.gt(0)) {
          const costSold = p.cost.div(p.qty).times(sold);
          p.realized = p.realized.plus(proceeds.minus(costSold));
          p.cost = p.cost.minus(costSold);
        } else if (p.qty.gt(0)) {
          p.realizedKnown = false;
          if (p.costKnown) p.cost = p.cost.minus(p.cost.div(p.qty).times(sold));
        }
        p.qty = p.qty.minus(sold);
        if (p.qty.eq(0)) p.cost = ZERO;
        break;
      }
    }
  }

  const holdingsRaw = [...pos.entries()].filter(([, p]) => p.qty.gt(0) || !p.realized.eq(0) || !p.income.eq(0));
  let holdingsValue: Big | null = ZERO;
  const rows = holdingsRaw.map(([id, p]) => {
    const pr = prices[id];
    const fx = pr ? (pr.currency === baseCurrency ? D(1) : fxNow(pr.currency)) : null;
    const mv = pr && fx ? p.qty.times(D(pr.price)).times(fx) : null;
    if (p.qty.gt(0)) { if (mv && holdingsValue) holdingsValue = holdingsValue.plus(mv); else if (!mv) holdingsValue = null; }
    if (!p.costKnown && p.qty.gt(0)) warnings.add('Some holdings have no recorded purchase price, so their cost basis and gains are unknown.');
    const unreal = mv && p.costKnown && p.qty.gt(0) ? mv.minus(p.cost) : null;
    return { id, p, pr, mv, unreal };
  });
  if (!cashKnown) warnings.add('Cash can\'t be calculated because some trades have no price.');
  const cashOut = cashKnown && (contributionsRecorded || cash.gt(0)) ? cash : null;
  const total = holdingsValue == null ? null : cashOut == null ? holdingsValue : (holdingsValue as Big).plus(cashOut);

  const holdings: Holding[] = rows.filter(r => r.p.qty.gt(0)).map(({ id, p, pr, mv, unreal }) => ({
    instrumentId: id,
    quantity: fmtQty(p.qty),
    currency: pr?.currency ?? p.currency,
    avgCost: p.costKnown && p.qty.gt(0) ? fmtPrice(p.cost.div(p.qty)) : null,
    costBasis: p.costKnown ? money(p.cost) : null,
    costKnown: p.costKnown,
    price: pr ? pr.price : null,
    marketValue: mv ? money(mv) : null,
    unrealizedGain: unreal ? money(unreal) : null,
    unrealizedGainPct: unreal && p.cost.gt(0) ? pct(unreal.div(p.cost).times(100)) : null,
    realizedGain: p.realizedKnown ? money(p.realized) : null,
    income: money(p.income),
    weightPct: mv && total && total.gt(0) ? pct(mv.div(total).times(100)) : null,
    priceAsOf: pr?.asOf ?? null,
  })).sort((a, b) => Number(b.marketValue ?? 0) - Number(a.marketValue ?? 0));

  const realizedAll = rows.every(r => r.p.realizedKnown) ? sum(rows.map(r => r.p.realized)) : null;
  const unrealList = rows.filter(r => r.p.qty.gt(0));
  const unrealAll = unrealList.every(r => r.unreal) ? sum(unrealList.map(r => r.unreal!)) : null;
  const net = deposits.minus(withdrawals);
  return {
    baseCurrency,
    holdings,
    cash: cashOut ? money(cashOut) : null,
    holdingsValue: holdingsValue ? money(holdingsValue) : null,
    totalValue: total ? money(total) : null,
    netContributions: money(net),
    contributionsRecorded,
    realizedGain: realizedAll ? money(realizedAll) : null,
    unrealizedGain: unrealAll ? money(unrealAll) : null,
    income: money(income),
    fees: money(fees),
    investmentGain: contributionsRecorded && total && cashKnown ? money(total.minus(net)) : null,
    warnings: [...warnings],
  };
}

/** Quantity of each instrument held at the end of `date` (used for valuation history). */
export function quantitiesAt(transactions: Transaction[], date: string): Map<string, Big> {
  const q = new Map<string, Big>();
  for (const tx of sortTransactions(transactions)) {
    if (tx.tradeDate > date) break;
    if (!tx.instrumentId) continue;
    const cur = q.get(tx.instrumentId) ?? ZERO;
    if (tx.type === 'buy') q.set(tx.instrumentId, cur.plus(D(tx.quantity)));
    else if (tx.type === 'sell') { const n = cur.minus(D(tx.quantity)); q.set(tx.instrumentId, n.lt(0) ? ZERO : n); }
    else if (tx.type === 'split') q.set(tx.instrumentId, cur.times(D(tx.quantity)));
  }
  return q;
}

/**
 * External cash flows into the portfolio by date, in base currency. When deposits/withdrawals were
 * recorded, they are the flows (cash is part of the portfolio). When they weren't, the portfolio is
 * measured as holdings only, and each buy's cost is treated as money in and each sale's proceeds as
 * money out, so purchases are never counted as investment gains.
 */
export function externalFlows(transactions: Transaction[], baseCurrency: string, fxNow: (c: string) => Big | null) {
  const recorded = transactions.some(t => t.type === 'deposit' || t.type === 'withdrawal');
  const flows = new Map<string, Big>();
  const add = (d: string, v: Big) => flows.set(d, (flows.get(d) ?? ZERO).plus(v));
  const w = new Set<string>();
  for (const tx of transactions) {
    const conv = (v: Big) => toBase(v, tx, baseCurrency, w, fxNow);
    if (recorded) {
      if (tx.type === 'deposit') add(tx.tradeDate, conv(D(tx.amount)));
      if (tx.type === 'withdrawal') add(tx.tradeDate, conv(D(tx.amount)).times(-1));
    } else {
      if (tx.type === 'buy' && tx.price != null) add(tx.tradeDate, conv(D(tx.quantity).times(D(tx.price))).plus(conv(D(tx.fee || 0))));
      if (tx.type === 'sell' && tx.price != null) add(tx.tradeDate, conv(D(tx.quantity).times(D(tx.price))).minus(conv(D(tx.fee || 0))).times(-1));
      if (tx.type === 'dividend' || tx.type === 'interest') add(tx.tradeDate, conv(D(tx.amount)).times(-1)); // paid out of the holdings-only portfolio
    }
  }
  return { flows, includesCash: recorded };
}
