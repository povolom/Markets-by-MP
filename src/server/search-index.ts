// Instrument search: by ticker, company name, nickname or a close misspelling, best match first.
// The index is built once at startup; a query scans it with cheap string checks and only runs
// edit-distance matching when the cheap checks find little.
import type { Instrument } from '../domain/types';
import { ALIASES } from './providers/demo-catalogue';
import { ENTRIES } from './providers/universe';

const STOP = new Set(['inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 'plc', 'the', 'group', 'holdings', 'sa', 'class', 'trust', 'etf', 'index', 'fund', 'adr', 'and']);
export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => normalize(s).split(' ').filter(w => w && !STOP.has(w));
const compact = (x: string) => x.replace(/[ .-]/g, '');

function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface Row { i: Instrument; sym: string; base: string; name: string; nameWords: string[]; nameCompact: string; aliases: string[]; rank: number; curated: boolean; desc: string }
const CLASS_WEIGHT: Record<string, number> = { stock: 0, etf: 1, crypto: 1, index: 2, mutual_fund: 3, fx: 3 };

const ROWS: Row[] = [...ENTRIES.values()].map(e => {
  const sym = e.inst.symbol.toLowerCase();
  return { i: e.inst, sym, base: sym.replace(/-usd$/, '').replace(/[.-]/g, ''), name: normalize(e.inst.name), nameWords: words(e.inst.name), nameCompact: compact(normalize(e.inst.name)), aliases: (ALIASES[e.inst.id] ?? []).map(normalize), rank: e.rank, curated: e.curated, desc: e.curated ? e.inst.description.toLowerCase() : '' };
});

/** Rows by the first letter of each name word, so typo matching only looks at plausible candidates. */
const BY_LETTER = new Map<string, Row[]>();
for (const r of ROWS) for (const ch of new Set(r.nameWords.map(w => w[0]).concat(r.sym[0]))) { const l = BY_LETTER.get(ch); if (l) l.push(r); else BY_LETTER.set(ch, [r]); }

function score(r: Row, q: string, qs: string, qWords: string[], tsx: boolean): number {
  if (r.sym === qs || r.base === qs.replace(/[.-]/g, '')) return tsx && r.i.exchange !== 'XTSE' ? 90 : 100;
  if (r.aliases.includes(q)) return 95;
  if (r.sym.startsWith(qs)) return 85 - Math.min(10, r.sym.length - qs.length);
  if (r.name.startsWith(q)) return 80;
  if (r.aliases.some(a => a.startsWith(q))) return 75;
  if (qWords.length && qWords.every(w => r.nameWords.some(nw => nw.startsWith(w)))) return 70;
  if (q.length >= 3 && (r.name.includes(q) || r.aliases.some(a => a.includes(q)))) return 55;
  if (qs.length >= 4 && (r.nameCompact.includes(qs) || r.aliases.some(a => compact(a).includes(qs)))) return 50;
  if (r.desc && q.length >= 4 && r.desc.includes(q)) return 20;
  return 0;
}

function fuzzy(r: Row, qWords: string[], qs: string): number {
  const long = qWords.filter(w => w.length >= 4);
  if (!long.length) return 0;
  const ok = qWords.every(w => w.length < 4 || r.nameWords.some(nw => {
    if (nw[0] !== w[0]) return false;
    const max = w.length >= 7 ? 2 : 1;
    return editDistance(w, nw.slice(0, w.length), max) <= max || editDistance(w, nw, max) <= max;
  }));
  if (ok) return 40;
  if (qs.length >= 3 && qs.length <= 5 && editDistance(qs, r.sym, 1) <= 1) return 35;
  return 0;
}

/** What people most often look for, shown before anything is typed. */
const POPULAR = ['xnas.aapl', 'xnas.nvda', 'xnas.msft', 'crypto.btc-usd', 'xtse.shop', 'xtse.xeqt', 'arcx.voo', 'xnas.tsla', 'xtse.ry', 'xnas.amzn', 'crypto.eth-usd', 'xnas.googl', 'xnas.meta', 'xtse.vfv', 'xtse.td', 'xnas.qqq', 'xnas.cost', 'xnys.jpm', 'xtse.enb', 'index.spx', 'fx.usdcad'];
const BY_ID = new Map(ROWS.map(r => [r.i.id, r]));

export function searchInstruments(query: string, keep: (i: Instrument) => boolean): Instrument[] {
  const tsx = /\.to$/i.test(query.trim());
  const q = normalize(query.replace(/\.to$/i, ''));
  const order = (a: { r: Row; s: number }, b: { r: Row; s: number }) => b.s - a.s || a.r.rank - b.r.rank || CLASS_WEIGHT[a.r.i.assetClass] - CLASS_WEIGHT[b.r.i.assetClass] || a.r.sym.length - b.r.sym.length || a.r.sym.localeCompare(b.r.sym);
  if (!q) return ROWS.filter(r => r.curated && keep(r.i)).map(r => ({ r, s: 0 })).sort(order).map(x => x.r.i);
  const qs = q.replace(/ /g, ''), qWords = words(q).length ? words(q) : [q];
  const hits: { r: Row; s: number }[] = [];
  for (const r of ROWS) { const s = score(r, q, qs, qWords, tsx); if (s && keep(r.i)) hits.push({ r, s }); }
  if (hits.filter(h => h.s >= 50).length < 8 && q.length >= 4) {
    const seen = new Set(hits.map(h => h.r));
    const lead = [...qWords].sort((a, b) => b.length - a.length)[0] ?? qs;
    for (const r of BY_LETTER.get(lead[0]) ?? []) { if (seen.has(r)) continue; const s = fuzzy(r, qWords, qs); if (s && keep(r.i)) hits.push({ r, s }); }
  }
  return hits.sort(order).map(h => h.r.i);
}

/** Exact symbol lookup for CSV imports: "SHOP.TO" means the TSX listing; otherwise prefer the most prominent. */
const BY_SYMBOL = new Map<string, Row[]>();
for (const r of ROWS) { const k = r.i.symbol.toUpperCase(); BY_SYMBOL.set(k, [...(BY_SYMBOL.get(k) ?? []), r]); }
export function resolveSymbol(symbol: string): string | null {
  const raw = symbol.trim();
  if (ENTRIES.has(raw.toLowerCase())) return raw.toLowerCase();
  const tsx = /\.TO$/i.test(raw);
  const s = raw.toUpperCase().replace(/\.TO$/, '');
  const list = [...(BY_SYMBOL.get(s) ?? []), ...(BY_SYMBOL.get(`${s}-USD`) ?? [])].filter(r => !tsx || r.i.exchange === 'XTSE');
  list.sort((a, b) => a.rank - b.rank);
  return list[0]?.i.id ?? null;
}
