// Exposure analysis shared by Portfolio X-Ray and What-If.
// - Direct exposure: each holding's share of the portfolio.
// - Look-through exposure: fund holdings are split into their underlying companies using the fund's
//   published composition (with its date and coverage). The part of a fund that isn't described is
//   reported as "Not covered", never as zero exposure. Funds held inside funds aren't expanded again,
//   so nothing is double-counted.
import Big from 'big.js';
import { D, ZERO, money, pct } from './decimal';
import type { FundComposition, Instrument } from './types';

export interface Position { instrumentId: string; value: Big /* base currency */ }
export type Lookup = (id: string) => Instrument | undefined;
export type Composition = (id: string) => FundComposition | undefined;

export const NOT_COVERED = 'Not covered by holdings data';

function addTo(map: Map<string, Big>, key: string, v: Big) { map.set(key, (map.get(key) ?? ZERO).plus(v)); }
function asShares(map: Map<string, Big>, total: Big) {
  return [...map.entries()].map(([key, v]) => ({ key, value: money(v), pct: total.gt(0) ? pct(v.div(total).times(100)) : '0.00' }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

export function exposures(positions: Position[], cash: Big | null, inst: Lookup, comp: Composition) {
  const total = positions.reduce((s, p) => s.plus(p.value), cash ?? ZERO);
  const company = new Map<string, Big>(), companyDirect = new Map<string, Big>(), sector = new Map<string, Big>(), country = new Map<string, Big>(), currency = new Map<string, Big>(), assetClass = new Map<string, Big>();
  const names = new Map<string, string>();
  const funds: { instrumentId: string; asOf: string; coveragePct: string }[] = [];
  if (cash && cash.gt(0)) { addTo(sector, 'Cash', cash); addTo(assetClass, 'cash', cash); }

  for (const p of positions) {
    const i = inst(p.instrumentId);
    if (!i) continue;
    addTo(currency, i.currency, p.value);
    addTo(assetClass, i.assetClass, p.value);
    const c = (i.assetClass === 'etf' || i.assetClass === 'mutual_fund') ? comp(i.id) : undefined;
    if (c) {
      funds.push({ instrumentId: i.id, asOf: c.asOf, coveragePct: c.coveragePct });
      let described = ZERO;
      for (const h of c.holdings) {
        const v = p.value.times(D(h.weightPct)).div(100);
        described = described.plus(v);
        const key = h.instrumentId ?? `name:${h.name}`;
        names.set(key, h.name);
        addTo(company, key, v);
      }
      const rest = p.value.minus(described);
      if (rest.gt(0)) addTo(company, NOT_COVERED, rest);
      for (const [s, w] of Object.entries(c.sectors)) addTo(sector, s, p.value.times(D(w)).div(100));
      for (const [k, w] of Object.entries(c.countries)) addTo(country, k, p.value.times(D(w)).div(100));
      const sw = Object.values(c.sectors).reduce((s, w) => s.plus(D(w)), ZERO), cw = Object.values(c.countries).reduce((s, w) => s.plus(D(w)), ZERO);
      if (sw.lt(100)) addTo(sector, NOT_COVERED, p.value.times(D(100).minus(sw)).div(100));
      if (cw.lt(100)) addTo(country, NOT_COVERED, p.value.times(D(100).minus(cw)).div(100));
    } else if (i.assetClass === 'etf' || i.assetClass === 'mutual_fund') {
      funds.push({ instrumentId: i.id, asOf: '', coveragePct: '0.00' });
      addTo(company, NOT_COVERED, p.value); addTo(sector, NOT_COVERED, p.value); addTo(country, NOT_COVERED, p.value);
    } else {
      names.set(i.id, i.name);
      addTo(company, i.id, p.value); addTo(companyDirect, i.id, p.value);
      addTo(sector, i.sector ?? (i.assetClass === 'crypto' ? 'Crypto' : 'Other'), p.value);
      addTo(country, i.country ?? (i.assetClass === 'crypto' ? 'Global (crypto)' : 'Unknown'), p.value);
    }
  }
  if (cash && cash.gt(0)) addTo(currency, 'cash', ZERO);
  const companies = asShares(company, total).map(r => ({ ...r, name: r.key === NOT_COVERED ? NOT_COVERED : names.get(r.key) ?? r.key, instrumentId: r.key.startsWith('name:') || r.key === NOT_COVERED ? null : r.key, directValue: money(companyDirect.get(r.key) ?? ZERO) }));
  const top = companies.find(c => c.key !== NOT_COVERED);
  // Concentration: Herfindahl index of known company exposures (0 to 10,000).
  const hhi = companies.filter(c => c.key !== NOT_COVERED).reduce((s, c) => s.plus(D(c.pct).pow(2)), ZERO);
  return {
    totalValue: money(total), companies, sectors: asShares(sector, total), countries: asShares(country, total),
    currencies: asShares(currency, total).filter(r => r.key !== 'cash'), assetClasses: asShares(assetClass, total),
    funds, largestCompanyPct: top?.pct ?? null, concentrationIndex: hhi.round(0).toString(),
  };
}

/** Overlap between two funds: the sum over shared holdings of the smaller weight. */
export function fundOverlap(a: FundComposition, b: FundComposition) {
  const wb = new Map(b.holdings.filter(h => h.instrumentId).map(h => [h.instrumentId!, D(h.weightPct)]));
  let overlap = ZERO; const shared: { instrumentId: string; name: string; weightA: string; weightB: string }[] = [];
  for (const h of a.holdings) {
    if (!h.instrumentId || !wb.has(h.instrumentId)) continue;
    const x = D(h.weightPct), y = wb.get(h.instrumentId)!;
    overlap = overlap.plus(x.lt(y) ? x : y);
    shared.push({ instrumentId: h.instrumentId, name: h.name, weightA: h.weightPct, weightB: y.toFixed(2) });
  }
  return { overlapPct: pct(overlap), shared, basedOnCoverage: [a.coveragePct, b.coveragePct] as [string, string] };
}
