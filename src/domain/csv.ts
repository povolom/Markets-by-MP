// CSV import: parse, map columns, validate each row, detect duplicates, and build a preview.
// Nothing is saved here; the API commits a previewed batch, and a batch can be reverted.
import { isDec } from './decimal';
import type { TransactionType } from './types';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); if (row.some(x => x.trim() !== '')) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

export type Field = 'date' | 'type' | 'symbol' | 'quantity' | 'price' | 'amount' | 'currency' | 'fee' | 'note';
export const FIELDS: Field[] = ['date', 'type', 'symbol', 'quantity', 'price', 'amount', 'currency', 'fee', 'note'];

const ALIASES: Record<Field, string[]> = {
  date: ['date', 'trade date', 'transaction date', 'settlement date', 'process date'],
  type: ['type', 'action', 'activity', 'transaction type', 'transaction'],
  symbol: ['symbol', 'ticker', 'security', 'instrument'],
  quantity: ['quantity', 'qty', 'shares', 'units'],
  price: ['price', 'unit price', 'price per share'],
  amount: ['amount', 'net amount', 'value', 'total'],
  currency: ['currency', 'ccy'],
  fee: ['fee', 'fees', 'commission'],
  note: ['note', 'notes', 'description', 'memo'],
};

/** Best-guess mapping from header names; the user can change it before previewing. */
export function guessMapping(header: string[]): Partial<Record<Field, number>> {
  const m: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const n = h.trim().toLowerCase();
    for (const f of FIELDS) if (m[f] === undefined && ALIASES[f].includes(n)) m[f] = i;
  });
  return m;
}

const TYPE_WORDS: Record<string, TransactionType> = {
  buy: 'buy', bought: 'buy', purchase: 'buy', sell: 'sell', sold: 'sell', sale: 'sell',
  dividend: 'dividend', div: 'dividend', distribution: 'dividend', fee: 'fee', commission: 'fee',
  deposit: 'deposit', contribution: 'deposit', cont: 'deposit', withdrawal: 'withdrawal', wd: 'withdrawal',
  split: 'split', interest: 'interest', int: 'interest',
};

export interface PreviewRow {
  line: number;                          // 1-based line in the file
  status: 'ok' | 'error' | 'duplicate';
  errors: string[];
  tx: null | { type: TransactionType; tradeDate: string; symbol: string | null; instrumentId: string | null; quantity: string | null; price: string | null; amount: string | null; currency: string; fee: string; note: string; dedupeHash: string };
}

/** FNV-1a 64-bit, hex. Stable across the browser and the server. */
export function fnv1a(s: string): string {
  let h = 0xcbf29ce484222325n; const p = 0x100000001b3n;
  for (const ch of new TextEncoder().encode(s)) { h ^= BigInt(ch); h = (h * p) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}

export function txHash(t: { type: string; tradeDate: string; instrumentId: string | null; quantity: string | null; price: string | null; amount: string | null; currency: string }, occurrence = 0) {
  const n = (v: string | null) => (v == null || v === '' ? '' : String(Number(v)));
  return fnv1a([t.type, t.tradeDate, t.instrumentId ?? '', n(t.quantity), n(t.price), n(t.amount), t.currency, occurrence].join('|'));
}

function normDate(v: string, format: 'ymd' | 'mdy' | 'dmy'): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else {
    const p = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!p || format === 'ymd') return null;
    [m, d] = format === 'mdy' ? [+p[1], +p[2]] : [+p[2], +p[1]]; y = +p[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const num = (v: string | undefined) => (v ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');

export function previewImport(
  rows: string[][], mapping: Partial<Record<Field, number>>,
  opts: { hasHeader: boolean; dateFormat: 'ymd' | 'mdy' | 'dmy'; defaultCurrency: string; today: string },
  resolveSymbol: (symbol: string) => string | null,
  existingHashes: Set<string>,
): PreviewRow[] {
  const seen = new Map<string, number>();
  const body = opts.hasHeader ? rows.slice(1) : rows;
  return body.map((r, i): PreviewRow => {
    const line = i + (opts.hasHeader ? 2 : 1);
    const get = (f: Field) => (mapping[f] === undefined ? undefined : r[mapping[f]!]?.trim());
    const errors: string[] = [];
    const rawType = (get('type') ?? '').toLowerCase();
    const type = TYPE_WORDS[rawType];
    if (!type) errors.push(rawType ? `Unknown type "${rawType}".` : 'Missing type.');
    const tradeDate = normDate(get('date') ?? '', opts.dateFormat);
    if (!tradeDate) errors.push('Missing or unreadable date.');
    else if (tradeDate > opts.today) errors.push('Date is in the future.');
    const symbol = get('symbol') || null;
    const needsInstrument = type && ['buy', 'sell', 'split', 'dividend'].includes(type);
    const instrumentId = symbol ? resolveSymbol(symbol) : null;
    if (needsInstrument && !symbol && type !== 'dividend') errors.push('Missing symbol.');
    if (symbol && !instrumentId) errors.push(`Symbol "${symbol}" isn't in Markets' coverage.`);
    const qtyS = num(get('quantity')), priceS = num(get('price')), amtS = num(get('amount')), feeS = num(get('fee')) || '0';
    let quantity: string | null = null, price: string | null = null, amount: string | null = null;
    if (type === 'buy' || type === 'sell' || type === 'split') {
      if (!isDec(qtyS) || Number(qtyS) <= 0) errors.push('Quantity must be a positive number.'); else quantity = String(Math.abs(Number(qtyS)) === Number(qtyS) ? qtyS : qtyS.replace('-', ''));
      if (type !== 'split') {
        if (priceS === '') price = null; // allowed: cost basis will be shown as unknown
        else if (!isDec(priceS) || Number(priceS) < 0) errors.push('Price must be a number.'); else price = priceS;
      }
    } else if (type) {
      if (!isDec(amtS)) errors.push('Amount must be a number.'); else amount = amtS.replace('-', '');
    }
    if (!isDec(feeS) || Number(feeS) < 0) errors.push('Fee must be a non-negative number.');
    const currency = (get('currency') || opts.defaultCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.push('Currency must be a 3-letter code.');
    if (errors.length || !type || !tradeDate) return { line, status: 'error', errors, tx: null };
    const base = { type, tradeDate, instrumentId, quantity, price, amount, currency };
    const plain = txHash(base, 0);
    const occ = seen.get(plain) ?? 0; seen.set(plain, occ + 1);
    const dedupeHash = txHash(base, occ);
    const duplicate = existingHashes.has(dedupeHash);
    return { line, status: duplicate ? 'duplicate' : 'ok', errors: duplicate ? ['Already in this portfolio; it will be skipped.'] : [], tx: { ...base, symbol, fee: feeS, note: get('note') ?? '', dedupeHash } };
  });
}
