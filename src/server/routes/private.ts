// Signed-in Markets API. Every handler resolves the caller from the session and every query is scoped
// to that user ID, so an ID from another account always returns 404, never someone else's data.
import { OpenAPIHono, createRoute, z, type RouteConfig } from '@hono/zod-openapi';
import { D, isDec, money } from '../../domain/decimal';
import { guessMapping, parseCsv, previewImport, txHash, FIELDS, type Field } from '../../domain/csv';
import { allocateCash, levelsReached, nextReviewDate, planCommitment, type PlanInput } from '../../domain/plans';
import type { AppEnv } from '../env';
import { all, first, json as parseJson, run, stmt } from '../db';
import { ApiError, badRequest, newId, notFound } from '../http';
import type { Market } from '../market';
import { ownedPortfolio, performance, simulate, summarize, transactions, xray, baseCurrency } from '../portfolio-service';
import { evaluateUser, ruleTargets, toRuleInput, type RuleRow } from '../jobs/alerts';
import { evaluateRule } from '../../domain/dips';
import { DEMO_POSTS, seedDemo } from '../demo-seed';
import { SAMPLE_PORTFOLIOS, sampleView, sharedRow, sharedView, viewerHoldings } from '../community';
import * as S from '../schemas';

const err = (d: string) => ({ description: d, content: { 'application/json': { schema: S.ErrorBody } } });
const ok = (description: string) => ({ 200: { description, content: { 'application/json': { schema: S.Any } } }, 400: err('Invalid request'), 401: err('Sign in required'), 404: err('Not found, or not yours') });
const IdParam = (name = 'id') => z.object({ [name]: z.string().min(1).max(64).openapi({ param: { name, in: 'path' } }) });
const Instr = z.string().min(1).max(64);
const Money = z.string().refine(isDec, 'Must be a decimal number');
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function privateRoutes(market: () => Market) {
  const app = new OpenAPIHono<AppEnv>();
  const uid = (c: any): string => { const u = c.get('userId'); if (!u) throw new ApiError(401, 'unauthorized', 'Sign in to use this endpoint.'); return u; };
  const out = (c: any, data: unknown, status = 200) => c.json(data as any, status);
  const assertInstrument = (id: string) => market().instrument(id);
  const route = <M extends 'get' | 'post' | 'put' | 'patch' | 'delete', P extends string, R extends NonNullable<RouteConfig['request']> = {}>(method: M, path: P, tag: string, summary: string, request?: R) =>
    createRoute({ method, path, tags: [tag], summary, request: (request ?? {}) as R, responses: ok(summary), security: [{ session: [] }] });

  // ---------- Account ----------
  app.openapi(route('get', '/me', 'Account', 'Your profile and settings'), async c => {
    const id = uid(c);
    const u = await first<any>(c.env.DB, 'SELECT id, name, email, emailVerified, isAnonymous, createdAt FROM "user" WHERE id = ?', id);
    let p = await first<any>(c.env.DB, 'SELECT * FROM profiles WHERE user_id = ?', id);
    if (!p) { await run(c.env.DB, 'INSERT OR IGNORE INTO profiles (user_id, display_name) VALUES (?, ?)', id, u?.isAnonymous ? 'Guest' : (u?.name ?? '')); p = await first<any>(c.env.DB, 'SELECT * FROM profiles WHERE user_id = ?', id); }
    return out(c, { data: {
      id, email: u?.isAnonymous ? null : u?.email, emailVerified: Boolean(u?.emailVerified), isGuest: Boolean(u?.isAnonymous), createdAt: u?.createdAt,
      displayName: p.display_name, baseCurrency: p.base_currency, interests: parseJson(p.interests, []), preferences: parseJson(p.preferences, {}), onboarded: p.onboarded === 1, isDemo: p.is_demo === 1,
    } });
  });

  app.openapi(route('patch', '/me', 'Account', 'Update your profile, onboarding answers and preferences', { body: { content: { 'application/json': { schema: z.object({
    displayName: z.string().max(60).optional(), baseCurrency: z.enum(['CAD', 'USD']).optional(), interests: z.array(z.string().max(32)).max(20).optional(),
    preferences: z.record(z.string(), z.any()).optional(), onboarded: z.boolean().optional() }) } } } }), async c => {
    const id = uid(c); const b = c.req.valid('json');
    const cur = await first<any>(c.env.DB, 'SELECT * FROM profiles WHERE user_id = ?', id);
    if (!cur) await run(c.env.DB, 'INSERT INTO profiles (user_id) VALUES (?)', id);
    const prefs = b.preferences ? JSON.stringify({ ...parseJson(cur?.preferences, {}), ...b.preferences }) : null;
    await run(c.env.DB, `UPDATE profiles SET display_name = COALESCE(?, display_name), base_currency = COALESCE(?, base_currency), interests = COALESCE(?, interests), preferences = COALESCE(?, preferences), onboarded = COALESCE(?, onboarded), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?`,
      b.displayName ?? null, b.baseCurrency ?? null, b.interests ? JSON.stringify(b.interests) : null, prefs, b.onboarded == null ? null : (b.onboarded ? 1 : 0), id);
    return out(c, { ok: true });
  });

  app.openapi(route('get', '/me/export', 'Account', 'Download all your data as JSON'), async c => {
    const id = uid(c); const db = c.env.DB;
    const q = (sql: string) => all(db, sql, id);
    const data = {
      exportedAt: new Date().toISOString(), profile: await first(db, 'SELECT * FROM profiles WHERE user_id = ?', id),
      watchlists: await q('SELECT * FROM watchlists WHERE user_id = ?'), watchlistItems: await q('SELECT i.* FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE w.user_id = ?'),
      portfolios: await q('SELECT * FROM portfolios WHERE user_id = ?'), transactions: await q('SELECT * FROM transactions WHERE user_id = ?'), importBatches: await q('SELECT * FROM import_batches WHERE user_id = ?'),
      alertRules: await q('SELECT * FROM alert_rules WHERE user_id = ?'), alertEvents: await q('SELECT * FROM alert_events WHERE user_id = ?'), plans: await q('SELECT * FROM plans WHERE user_id = ?'),
      journal: await q('SELECT * FROM journal_entries WHERE user_id = ?'), connections: await q('SELECT * FROM connections WHERE user_id = ?'), bookmarks: await q('SELECT * FROM bookmarks WHERE user_id = ?'),
    };
    const res = out(c, data);
    res.headers.set('Content-Disposition', 'attachment; filename="markets-export.json"');
    return res;
  });

  app.openapi(route('delete', '/me', 'Account', 'Delete your account and all your data', { body: { content: { 'application/json': { schema: z.object({ confirm: z.literal('DELETE') }) } } } }), async c => {
    const id = uid(c); c.req.valid('json');
    await run(c.env.DB, 'DELETE FROM "user" WHERE id = ?', id); // cascades to every table with user data
    return out(c, { ok: true, deleted: true });
  });

  app.openapi(route('post', '/demo/seed', 'Account', 'Fill a guest workspace with labelled demo data (guests only)'), async c => {
    const id = uid(c);
    if (!c.get('isAnonymous')) throw new ApiError(403, 'forbidden', 'Demo data is only added to guest workspaces. Real accounts start empty.');
    return out(c, await seedDemo(c.env.DB, market(), id));
  });

  // ---------- Watchlists ----------
  const ownedWatchlist = async (db: D1Database, userId: string, id: string) => { const w = await first<any>(db, 'SELECT * FROM watchlists WHERE id = ? AND user_id = ?', id, userId); if (!w) throw notFound('Watchlist'); return w; };

  app.openapi(route('get', '/watchlists', 'Watchlists', 'Your watchlists with quotes and 30-day sparklines'), async c => {
    const id = uid(c); const m = market();
    const lists = await all<any>(c.env.DB, 'SELECT * FROM watchlists WHERE user_id = ? ORDER BY position, created_at', id);
    const items = await all<any>(c.env.DB, 'SELECT i.* FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE w.user_id = ? ORDER BY i.position, i.added_at', id);
    const ids = [...new Set(items.map(i => i.instrument_id))];
    const quotes = new Map((await Promise.all(ids.map(x => m.quote(x).catch(() => null)))).filter(Boolean).map(q => [q!.instrumentId, q!]));
    const spark = new Map(await Promise.all(ids.map(async x => [x, (await m.history(x, '1M').catch(() => [])).map(b => b.close)] as const)));
    return out(c, { data: lists.map(l => ({ id: l.id, name: l.name, position: l.position, items: items.filter(i => i.watchlist_id === l.id).map(i => ({ instrumentId: i.instrument_id, addedAt: i.added_at, instrument: m.lookup(i.instrument_id) ?? null, quote: quotes.get(i.instrument_id) ?? null, sparkline: spark.get(i.instrument_id) ?? [] })) })) });
  });

  app.openapi(route('post', '/watchlists', 'Watchlists', 'Create a watchlist', { body: { content: { 'application/json': { schema: z.object({ name: z.string().trim().min(1).max(60), instrumentIds: z.array(Instr).max(50).optional() }) } } } }), async c => {
    const id = uid(c); const b = c.req.valid('json');
    const n = (await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM watchlists WHERE user_id = ?', id))!.n;
    if (n >= 50) throw badRequest('You can have up to 50 watchlists.');
    const wid = newId('wl');
    (b.instrumentIds ?? []).forEach(assertInstrument);
    await c.env.DB.batch([stmt(c.env.DB, 'INSERT INTO watchlists (id, user_id, name, position) VALUES (?, ?, ?, ?)', wid, id, b.name, n), ...(b.instrumentIds ?? []).map((x, i) => stmt(c.env.DB, 'INSERT OR IGNORE INTO watchlist_items (id, watchlist_id, instrument_id, position) VALUES (?, ?, ?, ?)', newId('wi'), wid, x, i))]);
    return out(c, { data: { id: wid, name: b.name } }, 201);
  });

  app.openapi(route('patch', '/watchlists/{id}', 'Watchlists', 'Rename a watchlist', { params: IdParam(), body: { content: { 'application/json': { schema: z.object({ name: z.string().trim().min(1).max(60) }) } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedWatchlist(c.env.DB, u, id);
    await run(c.env.DB, 'UPDATE watchlists SET name = ? WHERE id = ? AND user_id = ?', c.req.valid('json').name, id, u);
    return out(c, { ok: true });
  });

  app.openapi(route('delete', '/watchlists/{id}', 'Watchlists', 'Delete a watchlist', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedWatchlist(c.env.DB, u, id);
    await run(c.env.DB, 'DELETE FROM watchlists WHERE id = ? AND user_id = ?', id, u);
    return out(c, { ok: true });
  });

  app.openapi(route('post', '/watchlists/reorder', 'Watchlists', 'Set the order of your watchlists', { body: { content: { 'application/json': { schema: z.object({ ids: z.array(z.string()).max(50) }) } } } }), async c => {
    const u = uid(c); const { ids } = c.req.valid('json');
    const mine = new Set((await all<{ id: string }>(c.env.DB, 'SELECT id FROM watchlists WHERE user_id = ?', u)).map(r => r.id));
    if (ids.some(x => !mine.has(x))) throw notFound('Watchlist');
    await c.env.DB.batch(ids.map((x, i) => stmt(c.env.DB, 'UPDATE watchlists SET position = ? WHERE id = ? AND user_id = ?', i, x, u)));
    return out(c, { ok: true });
  });

  app.openapi(route('post', '/watchlists/{id}/items', 'Watchlists', 'Add an instrument', { params: IdParam(), body: { content: { 'application/json': { schema: z.object({ instrumentId: Instr }) } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedWatchlist(c.env.DB, u, id);
    const { instrumentId } = c.req.valid('json'); assertInstrument(instrumentId);
    const n = (await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM watchlist_items WHERE watchlist_id = ?', id))!.n;
    if (n >= 200) throw badRequest('A watchlist can hold up to 200 instruments.');
    const r = await run(c.env.DB, 'INSERT OR IGNORE INTO watchlist_items (id, watchlist_id, instrument_id, position) VALUES (?, ?, ?, ?)', newId('wi'), id, instrumentId, n);
    return out(c, { ok: true, added: (r.meta?.changes ?? 0) > 0 });
  });

  app.openapi(route('delete', '/watchlists/{id}/items/{instrumentId}', 'Watchlists', 'Remove an instrument', { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }), instrumentId: z.string().openapi({ param: { name: 'instrumentId', in: 'path' } }) }) }), async c => {
    const u = uid(c); const { id, instrumentId } = c.req.valid('param'); await ownedWatchlist(c.env.DB, u, id);
    await run(c.env.DB, 'DELETE FROM watchlist_items WHERE watchlist_id = ? AND instrument_id = ?', id, instrumentId);
    return out(c, { ok: true });
  });

  // ---------- Portfolios ----------
  app.openapi(route('get', '/portfolios', 'Portfolios', 'Your portfolios'), async c => {
    const u = uid(c);
    return out(c, { data: (await all<any>(c.env.DB, 'SELECT p.*, (SELECT COUNT(*) FROM transactions t WHERE t.portfolio_id = p.id) AS tx_count FROM portfolios p WHERE p.user_id = ? ORDER BY p.created_at', u)).map(p => ({ id: p.id, name: p.name, kind: p.kind, createdAt: p.created_at, transactionCount: p.tx_count })) });
  });
  app.openapi(route('post', '/portfolios', 'Portfolios', 'Create a portfolio', { body: { content: { 'application/json': { schema: z.object({ name: z.string().trim().min(1).max(60) }) } } } }), async c => {
    const u = uid(c); const pid = newId('pf');
    await run(c.env.DB, 'INSERT INTO portfolios (id, user_id, name, kind) VALUES (?, ?, ?, ?)', pid, u, c.req.valid('json').name, 'manual');
    return out(c, { data: { id: pid } }, 201);
  });
  app.openapi(route('patch', '/portfolios/{id}', 'Portfolios', 'Rename a portfolio', { params: IdParam(), body: { content: { 'application/json': { schema: z.object({ name: z.string().trim().min(1).max(60) }) } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedPortfolio(c.env.DB, u, id);
    await run(c.env.DB, 'UPDATE portfolios SET name = ? WHERE id = ? AND user_id = ?', c.req.valid('json').name, id, u);
    return out(c, { ok: true });
  });
  app.openapi(route('delete', '/portfolios/{id}', 'Portfolios', 'Delete a portfolio and its transactions', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedPortfolio(c.env.DB, u, id);
    await run(c.env.DB, 'DELETE FROM portfolios WHERE id = ? AND user_id = ?', id, u);
    return out(c, { ok: true });
  });
  app.openapi(route('get', '/portfolios/{id}', 'Portfolios', 'Holdings, cash, income and gains', { params: IdParam() }), async c => {
    const u = uid(c); const s = await summarize(c.env.DB, market(), u, c.req.valid('param').id);
    // Today's change across holdings: units x change since the previous close, at today's FX rate.
    let day = D(0), dayKnown = s.summary.holdings.length > 0;
    for (const h of s.summary.holdings) { const q = s.quotes.find(x => x?.instrumentId === h.instrumentId); if (!q) { dayKnown = false; continue; } day = day.plus(D(h.quantity).times(D(q.change)).times(D(s.fx[q.currency] ?? 1))); }
    const hv = s.summary.holdingsValue ? D(s.summary.holdingsValue) : null;
    const today = dayKnown && hv ? { change: money(day), changePct: hv.minus(day).gt(0) ? day.div(hv.minus(day)).times(100).round(2).toFixed(2) : null } : null;
    return out(c, { data: { portfolio: s.portfolio, summary: s.summary, today, fx: s.fx, transactionCount: s.transactionCount, method: 'Average-cost method. Amounts are converted to your base currency at each trade date\'s rate; current values use today\'s rate.' } });
  });
  app.openapi(route('get', '/portfolios/{id}/performance', 'Portfolios', 'Time- and money-weighted returns, with an optional benchmark', { params: IdParam(), query: z.object({ benchmark: z.string().optional() }) }), async c => {
    const u = uid(c); const b = c.req.valid('query').benchmark; if (b) assertInstrument(b);
    return out(c, { data: await performance(c.env.DB, market(), u, c.req.valid('param').id, b ?? null) });
  });
  app.openapi(route('get', '/portfolios/{id}/xray', 'Portfolios', 'Portfolio X-Ray: direct and look-through exposure', { params: IdParam() }), async c => out(c, { data: await xray(c.env.DB, market(), uid(c), c.req.valid('param').id) }));
  app.openapi(route('post', '/portfolios/{id}/what-if', 'Portfolios', 'Simulate a trade or contribution (nothing is recorded)', { params: IdParam(), body: { content: { 'application/json': { schema: z.object({
    type: z.enum(['buy', 'sell', 'contribute']), instrumentId: Instr.optional(), quantity: Money.optional(), amount: Money.optional(), price: Money.optional(), fxToBase: Money.optional(), fee: Money.default('0'), funding: z.enum(['cash', 'new_money']).default('cash') }) } } } }), async c => {
    const b = c.req.valid('json');
    if (b.type !== 'contribute' && !b.quantity && !b.amount) throw badRequest('Enter a quantity or an amount.');
    if (b.type === 'contribute' && !b.amount) throw badRequest('Enter an amount to contribute.');
    return out(c, { data: await simulate(c.env.DB, market(), uid(c), c.req.valid('param').id, b as any) });
  });
  app.openapi(route('get', '/portfolios/{id}/income', 'Portfolios', 'Dividend income received and expected', { params: IdParam() }), async c => {
    const u = uid(c); const m = market(); const s = await summarize(c.env.DB, m, u, c.req.valid('param').id);
    const base = s.summary.baseCurrency;
    const received = s.txs.filter(t => t.type === 'dividend' || t.type === 'interest').map(t => ({ date: t.tradeDate, instrumentId: t.instrumentId, amount: t.amount, currency: t.currency, amountBase: money(D(t.amount).times(t.currency === base ? D(1) : D(t.fxToBase ?? s.fx[t.currency] ?? 1))), baseCurrency: base, status: 'received' }));
    const today = new Date().toISOString().slice(0, 10); const upcoming: any[] = [];
    for (const h of s.summary.holdings) for (const d of await m.dividends(h.instrumentId)) if (d.exDate > today) upcoming.push({ instrumentId: h.instrumentId, exDate: d.exDate, payDate: d.payDate, perUnit: d.amount, estimatedAmount: money(D(h.quantity).times(D(d.amount))), currency: d.currency, status: d.status });
    return out(c, { data: { received, upcoming: upcoming.sort((a, b) => a.exDate.localeCompare(b.exDate)), note: '"declared" payments have been announced; "projected" ones are estimates based on past payments and may not happen. Not tax advice or an official tax calculation.' } });
  });

  // ---------- Transactions & import ----------
  const TxBody = z.object({ type: z.enum(['buy', 'sell', 'dividend', 'fee', 'deposit', 'withdrawal', 'split', 'interest']), instrumentId: Instr.nullable().optional(), tradeDate: DateStr, quantity: Money.nullable().optional(), price: Money.nullable().optional(), amount: Money.nullable().optional(), currency: z.string().length(3).optional(), fee: Money.default('0'), note: z.string().max(500).default('') });
  app.openapi(route('get', '/portfolios/{id}/transactions', 'Transactions', 'List transactions', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedPortfolio(c.env.DB, u, id);
    return out(c, { data: (await transactions(c.env.DB, u, id)).reverse() });
  });
  app.openapi(route('post', '/portfolios/{id}/transactions', 'Transactions', 'Record a transaction (a record of something that happened, not an order)', { params: IdParam(), body: { content: { 'application/json': { schema: TxBody } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedPortfolio(c.env.DB, u, id); const b = c.req.valid('json'); const m = market();
    if (b.tradeDate > new Date().toISOString().slice(0, 10)) throw badRequest('The date can\'t be in the future.');
    const needsInst = ['buy', 'sell', 'split'].includes(b.type);
    if (needsInst && !b.instrumentId) throw badRequest('Choose an instrument.');
    const inst = b.instrumentId ? assertInstrument(b.instrumentId) : null;
    if (inst && !inst.tradable && b.type !== 'dividend') throw badRequest(`${inst.name} can't be bought or sold directly.`);
    if ((b.type === 'buy' || b.type === 'sell' || b.type === 'split') && !(b.quantity && D(b.quantity).gt(0))) throw badRequest('Quantity must be greater than zero.');
    if (!needsInst && !(b.amount && D(b.amount).gt(0))) throw badRequest('Amount must be greater than zero.');
    const currency = (b.currency ?? inst?.currency ?? await baseCurrency(c.env.DB, u)).toUpperCase();
    const base = await baseCurrency(c.env.DB, u);
    const fx = currency === base ? null : await m.fx(currency, base, b.tradeDate);
    const t = { type: b.type, tradeDate: b.tradeDate, instrumentId: b.instrumentId ?? null, quantity: b.quantity ?? null, price: b.price ?? null, amount: b.amount ?? null, currency };
    const existing = new Set((await all<{ dedupe_hash: string }>(c.env.DB, 'SELECT dedupe_hash FROM transactions WHERE portfolio_id = ?', id)).map(r => r.dedupe_hash));
    let n = 0; while (existing.has(txHash(t, n))) n++; // manual entries may repeat on purpose
    const tid = newId('tx');
    await run(c.env.DB, 'INSERT INTO transactions (id, user_id, portfolio_id, type, instrument_id, trade_date, quantity, price, amount, currency, fx_to_base, fee, note, dedupe_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', tid, u, id, b.type, t.instrumentId, b.tradeDate, t.quantity, t.price, t.amount, currency, fx, b.fee, b.note, txHash(t, n));
    return out(c, { data: { id: tid, fxToBase: fx, possibleDuplicate: n > 0 } }, 201);
  });
  app.openapi(route('delete', '/portfolios/{id}/transactions/{txId}', 'Transactions', 'Delete a transaction', { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }), txId: z.string().openapi({ param: { name: 'txId', in: 'path' } }) }) }), async c => {
    const u = uid(c); const { id, txId } = c.req.valid('param');
    const r = await run(c.env.DB, 'DELETE FROM transactions WHERE id = ? AND portfolio_id = ? AND user_id = ?', txId, id, u);
    if (!(r.meta?.changes)) throw notFound('Transaction');
    return out(c, { ok: true });
  });

  const ImportBody = z.object({ csv: z.string().max(2_000_000), filename: z.string().max(200).default(''), hasHeader: z.boolean().default(true), dateFormat: z.enum(['ymd', 'mdy', 'dmy']).default('ymd'), defaultCurrency: z.string().length(3).optional(), mapping: z.record(z.string(), z.number().int().min(0)).optional() });
  async function prepareImport(c: any, portfolioId: string) {
    const u = uid(c); await ownedPortfolio(c.env.DB, u, portfolioId); const b = c.req.valid('json'); const m = market();
    const rows = parseCsv(b.csv);
    if (!rows.length) throw badRequest('The file is empty.');
    if (rows.length > 5001) throw badRequest('Imports are limited to 5,000 rows at a time.');
    const mapping = (b.mapping ?? (b.hasHeader ? guessMapping(rows[0]) : {})) as Partial<Record<Field, number>>;
    const existing = new Set((await all<{ dedupe_hash: string }>(c.env.DB, 'SELECT dedupe_hash FROM transactions WHERE portfolio_id = ?', portfolioId)).map(r => r.dedupe_hash));
    const base = await baseCurrency(c.env.DB, u);
    const preview = previewImport(rows, mapping, { hasHeader: b.hasHeader, dateFormat: b.dateFormat, defaultCurrency: b.defaultCurrency ?? base, today: new Date().toISOString().slice(0, 10) }, s => m.resolveSymbol(s), existing);
    return { u, b, m, base, header: b.hasHeader ? rows[0] : null, mapping, preview };
  }
  app.openapi(route('post', '/portfolios/{id}/imports/preview', 'Transactions', 'Preview a CSV import: mapping, row errors and duplicates (nothing saved)', { params: IdParam(), body: { content: { 'application/json': { schema: ImportBody } } } }), async c => {
    const { header, mapping, preview } = await prepareImport(c, c.req.valid('param').id);
    const counts = { ok: preview.filter(r => r.status === 'ok').length, error: preview.filter(r => r.status === 'error').length, duplicate: preview.filter(r => r.status === 'duplicate').length };
    return out(c, { data: { header, mapping, fields: FIELDS, counts, rows: preview.slice(0, 500), truncated: preview.length > 500 } });
  });
  app.openapi(route('post', '/portfolios/{id}/imports', 'Transactions', 'Commit the valid rows of a CSV as one reversible batch', { params: IdParam(), body: { content: { 'application/json': { schema: ImportBody } } } }), async c => {
    const pid = c.req.valid('param').id;
    const { u, b, m, base, preview } = await prepareImport(c, pid);
    const good = preview.filter(r => r.status === 'ok' && r.tx);
    if (!good.length) throw badRequest('There are no valid new rows to import.');
    const batchId = newId('imp');
    const fxCache = new Map<string, string>();
    const fxFor = async (ccy: string, date: string) => { if (ccy === base) return null; const k = `${ccy}:${date}`; if (!fxCache.has(k)) fxCache.set(k, await m.fx(ccy, base, date)); return fxCache.get(k)!; };
    const stmts = [stmt(c.env.DB, 'INSERT INTO import_batches (id, user_id, portfolio_id, filename, row_count) VALUES (?, ?, ?, ?, ?)', batchId, u, pid, b.filename, good.length)];
    for (const r of good) { const t = r.tx!; stmts.push(stmt(c.env.DB, 'INSERT OR IGNORE INTO transactions (id, user_id, portfolio_id, type, instrument_id, trade_date, quantity, price, amount, currency, fx_to_base, fee, note, import_batch_id, dedupe_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newId('tx'), u, pid, t.type, t.instrumentId, t.tradeDate, t.quantity, t.price, t.amount, t.currency, await fxFor(t.currency, t.tradeDate), t.fee, t.note, batchId, t.dedupeHash)); }
    await c.env.DB.batch(stmts);
    return out(c, { data: { batchId, imported: good.length, skippedDuplicates: preview.filter(r => r.status === 'duplicate').length, errors: preview.filter(r => r.status === 'error').length } }, 201);
  });
  app.openapi(route('get', '/imports', 'Transactions', 'Your import batches'), async c => out(c, { data: await all(c.env.DB, 'SELECT * FROM import_batches WHERE user_id = ? ORDER BY created_at DESC', uid(c)) }));
  app.openapi(route('post', '/imports/{id}/revert', 'Transactions', 'Undo an import batch', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param');
    const bt = await first<any>(c.env.DB, 'SELECT * FROM import_batches WHERE id = ? AND user_id = ?', id, u);
    if (!bt) throw notFound('Import batch');
    if (bt.reverted_at) throw new ApiError(409, 'conflict', 'This import was already undone.');
    const r = await c.env.DB.batch([stmt(c.env.DB, 'DELETE FROM transactions WHERE import_batch_id = ? AND user_id = ?', id, u), stmt(c.env.DB, "UPDATE import_batches SET reverted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", id)]);
    return out(c, { ok: true, removed: r[0].meta?.changes ?? 0 });
  });

  // ---------- Alerts & Dip Radar ----------
  const RuleBody = z.object({
    name: z.string().max(80).default(''), scope: z.enum(['instrument', 'watchlist', 'holdings']), instrumentId: Instr.optional(), watchlistId: z.string().optional(), portfolioId: z.string().optional(),
    kind: z.enum(['below_rolling_high', 'below_52w_high', 'target_price', 'below_avg_cost', 'daily_drop', 'weekly_drop']), threshold: Money,
    windowDays: z.number().int().min(5).max(365).default(30), basis: z.enum(['close', 'intraday']).default('close'), resetBand: Money.default('2'), cooldownHours: z.number().int().min(1).max(720).default(24), notify: z.boolean().default(true), active: z.boolean().default(true),
  });
  async function validateRule(c: any, u: string, b: z.infer<typeof RuleBody>) {
    if (D(b.threshold).lte(0)) throw badRequest('The threshold must be greater than zero.');
    if (b.kind !== 'target_price' && D(b.threshold).gte(100)) throw badRequest('A percentage threshold must be below 100.');
    if (b.scope === 'instrument') { if (!b.instrumentId) throw badRequest('Choose an instrument.'); assertInstrument(b.instrumentId); }
    if (b.scope === 'watchlist') { if (!b.watchlistId) throw badRequest('Choose a watchlist.'); await ownedWatchlist(c.env.DB, u, b.watchlistId); }
    if (b.scope === 'holdings') { if (!b.portfolioId) throw badRequest('Choose a portfolio.'); await ownedPortfolio(c.env.DB, u, b.portfolioId); }
    if (b.kind === 'target_price' && b.scope !== 'instrument') throw badRequest('A target price applies to one instrument.');
    if (b.kind === 'below_avg_cost' && b.scope !== 'holdings') throw badRequest('"Below my average cost" applies to holdings.');
  }
  const ruleOut = (r: any) => ({ id: r.id, name: r.name, scope: r.scope, instrumentId: r.instrument_id, watchlistId: r.watchlist_id, portfolioId: r.portfolio_id, kind: r.kind, threshold: r.threshold, windowDays: r.window_days, basis: r.basis, resetBand: r.reset_band, cooldownHours: r.cooldown_hours, notify: r.notify === 1, active: r.active === 1, createdAt: r.created_at });
  app.openapi(route('get', '/alerts/rules', 'Alerts', 'Your alert rules'), async c => out(c, { data: (await all(c.env.DB, 'SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at', uid(c))).map(ruleOut) }));
  app.openapi(route('post', '/alerts/rules', 'Alerts', 'Create a rule', { body: { content: { 'application/json': { schema: RuleBody } } } }), async c => {
    const u = uid(c); const b = c.req.valid('json'); await validateRule(c, u, b);
    const id = newId('rule');
    await run(c.env.DB, 'INSERT INTO alert_rules (id, user_id, name, scope, instrument_id, watchlist_id, portfolio_id, kind, threshold, window_days, basis, reset_band, cooldown_hours, notify, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, u, b.name, b.scope, b.instrumentId ?? null, b.watchlistId ?? null, b.portfolioId ?? null, b.kind, b.threshold, b.windowDays, b.basis, b.resetBand, b.cooldownHours, b.notify ? 1 : 0, b.active ? 1 : 0);
    return out(c, { data: { id } }, 201);
  });
  app.openapi(route('patch', '/alerts/rules/{id}', 'Alerts', 'Edit a rule (its alert state resets)', { params: IdParam(), body: { content: { 'application/json': { schema: RuleBody } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); const b = c.req.valid('json');
    if (!(await first(c.env.DB, 'SELECT 1 FROM alert_rules WHERE id = ? AND user_id = ?', id, u))) throw notFound('Rule');
    await validateRule(c, u, b);
    await c.env.DB.batch([
      stmt(c.env.DB, 'UPDATE alert_rules SET name = ?, scope = ?, instrument_id = ?, watchlist_id = ?, portfolio_id = ?, kind = ?, threshold = ?, window_days = ?, basis = ?, reset_band = ?, cooldown_hours = ?, notify = ?, active = ? WHERE id = ? AND user_id = ?',
        b.name, b.scope, b.instrumentId ?? null, b.watchlistId ?? null, b.portfolioId ?? null, b.kind, b.threshold, b.windowDays, b.basis, b.resetBand, b.cooldownHours, b.notify ? 1 : 0, b.active ? 1 : 0, id, u),
      stmt(c.env.DB, 'DELETE FROM alert_state WHERE rule_id = ?', id),
    ]);
    return out(c, { ok: true });
  });
  app.openapi(route('delete', '/alerts/rules/{id}', 'Alerts', 'Delete a rule', { params: IdParam() }), async c => {
    const u = uid(c); const r = await run(c.env.DB, 'DELETE FROM alert_rules WHERE id = ? AND user_id = ?', c.req.valid('param').id, u);
    if (!(r.meta?.changes)) throw notFound('Rule');
    return out(c, { ok: true });
  });
  app.openapi(route('get', '/alerts/events', 'Alerts', 'Triggered alerts (notifications)', { query: z.object({ unread: z.enum(['true', 'false']).optional() }) }), async c => {
    const u = uid(c); const unread = c.req.valid('query').unread === 'true';
    const rows = await all<any>(c.env.DB, `SELECT * FROM alert_events WHERE user_id = ? ${unread ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 100`, u);
    return out(c, { data: rows.map(r => ({ id: r.id, ruleId: r.rule_id, instrumentId: r.instrument_id, observedAt: r.observed_at, value: r.value, reference: r.reference, message: r.message, readAt: r.read_at, createdAt: r.created_at })) });
  });
  app.openapi(route('post', '/alerts/events/read', 'Alerts', 'Mark alerts as read', { body: { content: { 'application/json': { schema: z.object({ ids: z.array(z.string()).max(200).optional() }) } } } }), async c => {
    const u = uid(c); const ids = c.req.valid('json').ids;
    if (ids?.length) await c.env.DB.batch(ids.map(x => stmt(c.env.DB, "UPDATE alert_events SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?", x, u)));
    else await run(c.env.DB, "UPDATE alert_events SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL", u);
    return out(c, { ok: true });
  });
  app.openapi(route('post', '/alerts/evaluate', 'Alerts', 'Check your rules now'), async c => out(c, { data: await evaluateUser(c.env.DB, market(), uid(c)) }));

  app.openapi(route('get', '/dip-radar', 'Dip Radar', 'Everything you follow, measured against your rules', { query: z.object({ windowDays: z.coerce.number().int().min(5).max(365).default(30), basis: z.enum(['close', 'intraday']).default('close') }) }), async c => {
    const u = uid(c); const m = market(); const q = c.req.valid('query');
    const rules = await all<RuleRow>(c.env.DB, 'SELECT * FROM alert_rules WHERE user_id = ? AND active = 1', u);
    const watched = await all<{ instrument_id: string; name: string }>(c.env.DB, 'SELECT i.instrument_id, w.name FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE w.user_id = ?', u);
    const portfolios = await all<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM portfolios WHERE user_id = ?', u);
    const exposure = new Map<string, { portfolioId: string; portfolio: string; weightPct: string | null; avgCost: string | null }[]>();
    for (const p of portfolios) { const s = await summarize(c.env.DB, m, u, p.id); for (const h of s.summary.holdings) exposure.set(h.instrumentId, [...(exposure.get(h.instrumentId) ?? []), { portfolioId: p.id, portfolio: p.name, weightPct: h.weightPct, avgCost: h.avgCost }]); }
    const ruleHits = new Map<string, { ruleId: string; name: string; kind: string; threshold: string; explanation: string }[]>();
    for (const r of rules) for (const t of await ruleTargets(c.env.DB, m, r)) {
      const ev = evaluateRule(toRuleInput(r), await m.fullHistory(t.id), (await m.quote(t.id)).price, t.avgCost);
      if (ev.matched) ruleHits.set(t.id, [...(ruleHits.get(t.id) ?? []), { ruleId: r.id, name: r.name, kind: r.kind, threshold: r.threshold, explanation: ev.explanation }]);
    }
    const ids = [...new Set([...watched.map(w => w.instrument_id), ...exposure.keys(), ...rules.filter(r => r.instrument_id).map(r => r.instrument_id!)])].filter(id => m.lookup(id)?.tradable);
    const rows = await Promise.all(ids.map(async id => ({ ...(await m.dipSnapshot(id, q.windowDays, q.basis)), sources: [...new Set(watched.filter(w => w.instrument_id === id).map(w => `Watchlist: ${w.name}`).concat((exposure.get(id) ?? []).map(e => `Holding: ${e.portfolio}`)))], exposure: exposure.get(id) ?? [], matchedRules: ruleHits.get(id) ?? [] })));
    return out(c, { data: rows, definition: `Drop from the highest ${q.basis === 'close' ? 'adjusted close' : 'intraday high'} in the last ${q.windowDays} calendar days, on today's price basis. The daily change is shown separately.`, reminder: 'A lower price alone doesn\'t mean better value.' });
  });

  app.openapi(route('get', '/context/{id}', 'Dip Radar', 'Dip Context: what accompanies a decline, with sources', { params: IdParam() }), async c => {
    const u = uid(c); const m = market(); const id = c.req.valid('param').id; const inst = m.instrument(id);
    const bench = inst.currency === 'CAD' ? 'index.tsx' : inst.assetClass === 'crypto' ? null : 'index.spx';
    const hist = await m.fullHistory(id);
    const ret = (bars: { date: string; adjClose: string }[], days: number) => { const end = bars[bars.length - 1]; const from = new Date(Date.parse(end.date) - days * 86400000).toISOString().slice(0, 10); const s = bars.find(b => b.date >= from) ?? bars[0]; return (Number(end.adjClose) / Number(s.adjClose) - 1) * 100; };
    const perf = (bars: any[]) => ({ d30: ret(bars, 30).toFixed(2), d90: ret(bars, 90).toFixed(2), y1: ret(bars, 365).toFixed(2) });
    const benchPerf = bench ? perf(await m.fullHistory(bench)) : null;
    const peers = m.instruments().filter(i => i.id !== id && i.sector && i.sector === inst.sector && i.assetClass === inst.assetClass);
    const peerPerf = await Promise.all(peers.map(async p => ({ instrumentId: p.id, ...perf(await m.fullHistory(p.id)) })));
    const [stats, events, news, snap30, snap365] = await Promise.all([m.statistics(id), m.events(id), m.news([id]), m.dipSnapshot(id, 30), m.dipSnapshot(id, 365)]);
    const today = new Date().toISOString().slice(0, 10);
    const portfolios = await all<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM portfolios WHERE user_id = ?', u);
    const exposure = [];
    for (const p of portfolios) { const x = await xray(c.env.DB, m, u, p.id).catch(() => null); const row = x?.companies.find(r => r.instrumentId === id); if (row) exposure.push({ portfolioId: p.id, portfolio: p.name, totalPct: row.pct, directValue: row.directValue, value: row.value }); }
    return out(c, { data: {
      instrumentId: id,
      observations: {
        drop: { from30dHigh: snap30.dropPct, from52wHigh: snap365.dropPct, dailyChangePct: snap30.quote.changePct },
        performance: { instrument: perf(hist), benchmark: bench ? { instrumentId: bench, ...benchPerf } : null, sectorPeers: peerPerf, note: 'Total returns from adjusted closes over calendar periods ending at the last completed session.' },
        volatility1y: stats.volatility1y, maxDrawdown1y: stats.maxDrawdown1y,
        recentEvents: events.filter(e => e.date <= today && e.date >= new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)),
        upcomingEvents: events.filter(e => e.date > today).slice(0, 4),
        news: news.slice(0, 5),
        portfolioExposure: exposure,
      },
      hypotheses: [],
      unknown: 'Markets can\'t tell why this price moved. The items above happened around the same time; that doesn\'t mean they caused it.',
      reminder: 'A price decline alone doesn\'t establish that something is undervalued.',
      provenance: m.provider.info.provenance,
    } });
  });

  // ---------- Buy Plans ----------
  const PlanBody = z.object({ name: z.string().trim().min(1).max(80), mode: z.enum(['regular', 'dip', 'hybrid']), instrumentId: Instr, portfolioId: z.string().nullable().optional(), schedule: z.enum(['weekly', 'biweekly', 'monthly']).default('monthly'), regularAmount: Money.default('0'), levels: z.array(z.object({ dropPct: Money, amount: Money })).max(6).default([]), maxTotal: Money.default('0'), status: z.enum(['active', 'paused', 'archived']).default('active'), alertRuleId: z.string().nullable().optional() });
  const planOut = (p: any): PlanInput & any => ({ id: p.id, name: p.name, mode: p.mode, instrumentId: p.instrument_id, portfolioId: p.portfolio_id, schedule: p.schedule, regularAmount: p.regular_amount, levels: parseJson(p.levels, []), maxTotal: p.max_total, currency: p.currency, nextReview: p.next_review, status: p.status, alertRuleId: p.alert_rule_id, createdAt: p.created_at });
  async function validatePlan(c: any, u: string, b: z.infer<typeof PlanBody>) {
    const inst = assertInstrument(b.instrumentId);
    if (!inst.tradable) throw badRequest(`${inst.name} can't be bought directly; choose a fund that tracks it.`);
    if (b.portfolioId) await ownedPortfolio(c.env.DB, u, b.portfolioId);
    if (b.mode !== 'dip' && !D(b.regularAmount).gt(0)) throw badRequest('Set a regular amount.');
    if (b.mode !== 'regular' && !b.levels.length) throw badRequest('Add at least one dip level.');
    if (b.levels.some(l => !D(l.dropPct).gt(0) || !D(l.amount).gt(0))) throw badRequest('Each level needs a drop and an amount above zero.');
    if (b.alertRuleId && !(await first(c.env.DB, 'SELECT 1 FROM alert_rules WHERE id = ? AND user_id = ?', b.alertRuleId, u))) throw notFound('Rule');
  }
  app.openapi(route('get', '/plans', 'Plans', 'Your Buy Plans with commitments and cash allocation'), async c => {
    const u = uid(c); const m = market();
    const plans = (await all<any>(c.env.DB, 'SELECT * FROM plans WHERE user_id = ? ORDER BY created_at', u)).map(planOut);
    const byPortfolio = new Map<string | null, any[]>(); for (const p of plans) byPortfolio.set(p.portfolioId, [...(byPortfolio.get(p.portfolioId) ?? []), p]);
    const allocations = [];
    for (const [pid, ps] of byPortfolio) {
      const cash = pid ? (await summarize(c.env.DB, m, u, pid).catch(() => null))?.summary.cash ?? null : null;
      allocations.push({ portfolioId: pid, availableCash: cash, ...allocateCash(cash, ps) });
    }
    const rows = await Promise.all(plans.map(async p => { const snap = await m.dipSnapshot(p.instrumentId, 30).catch(() => null); return { ...p, commitment: planCommitment(p), current: snap ? { price: snap.quote.price, dropPct: snap.dropPct } : null, levelsReached: levelsReached(p.levels, snap?.dropPct ?? null) }; }));
    return out(c, { data: rows, allocations, notice: 'Plans are notes to yourself, not orders. Markets never buys, sells or moves money.' });
  });
  app.openapi(route('post', '/plans', 'Plans', 'Save a plan', { body: { content: { 'application/json': { schema: PlanBody } } } }), async c => {
    const u = uid(c); const b = c.req.valid('json'); await validatePlan(c, u, b);
    const id = newId('plan'); const inst = assertInstrument(b.instrumentId);
    await run(c.env.DB, 'INSERT INTO plans (id, user_id, name, mode, instrument_id, portfolio_id, schedule, regular_amount, levels, max_total, currency, next_review, status, alert_rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, u, b.name, b.mode, b.instrumentId, b.portfolioId ?? null, b.schedule, b.regularAmount, JSON.stringify(b.levels), b.maxTotal, await baseCurrency(c.env.DB, u), nextReviewDate(new Date().toISOString().slice(0, 10), b.schedule), b.status, b.alertRuleId ?? null);
    void inst;
    return out(c, { data: { id } }, 201);
  });
  app.openapi(route('patch', '/plans/{id}', 'Plans', 'Edit a plan', { params: IdParam(), body: { content: { 'application/json': { schema: PlanBody } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); const b = c.req.valid('json');
    if (!(await first(c.env.DB, 'SELECT 1 FROM plans WHERE id = ? AND user_id = ?', id, u))) throw notFound('Plan');
    await validatePlan(c, u, b);
    await run(c.env.DB, 'UPDATE plans SET name = ?, mode = ?, instrument_id = ?, portfolio_id = ?, schedule = ?, regular_amount = ?, levels = ?, max_total = ?, status = ?, alert_rule_id = ? WHERE id = ? AND user_id = ?', b.name, b.mode, b.instrumentId, b.portfolioId ?? null, b.schedule, b.regularAmount, JSON.stringify(b.levels), b.maxTotal, b.status, b.alertRuleId ?? null, id, u);
    return out(c, { ok: true });
  });
  app.openapi(route('delete', '/plans/{id}', 'Plans', 'Delete a plan', { params: IdParam() }), async c => {
    const r = await run(c.env.DB, 'DELETE FROM plans WHERE id = ? AND user_id = ?', c.req.valid('param').id, uid(c)); if (!(r.meta?.changes)) throw notFound('Plan');
    return out(c, { ok: true });
  });

  // ---------- Journal ----------
  const JournalBody = z.object({ title: z.string().trim().min(1).max(120), instrumentId: Instr.nullable().optional(), planId: z.string().nullable().optional(), transactionId: z.string().nullable().optional(), thesis: z.string().max(5000).default(''), sources: z.array(z.string().max(500)).max(20).default([]), concerns: z.string().max(5000).default(''), horizon: z.string().max(60).default(''), reviewDate: DateStr.nullable().optional(), reflection: z.string().max(5000).default('') });
  const jOut = (r: any) => ({ id: r.id, title: r.title, instrumentId: r.instrument_id, planId: r.plan_id, transactionId: r.transaction_id, thesis: r.thesis, sources: parseJson(r.sources, []), concerns: r.concerns, horizon: r.horizon, reviewDate: r.review_date, reflection: r.reflection, createdAt: r.created_at, updatedAt: r.updated_at });
  async function validateJournal(c: any, u: string, b: z.infer<typeof JournalBody>) {
    if (b.instrumentId) assertInstrument(b.instrumentId);
    if (b.planId && !(await first(c.env.DB, 'SELECT 1 FROM plans WHERE id = ? AND user_id = ?', b.planId, u))) throw notFound('Plan');
    if (b.transactionId && !(await first(c.env.DB, 'SELECT 1 FROM transactions WHERE id = ? AND user_id = ?', b.transactionId, u))) throw notFound('Transaction');
  }
  app.openapi(route('get', '/journal', 'Journal', 'Your journal entries'), async c => out(c, { data: (await all(c.env.DB, 'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY updated_at DESC', uid(c))).map(jOut) }));
  app.openapi(route('post', '/journal', 'Journal', 'Write an entry', { body: { content: { 'application/json': { schema: JournalBody } } } }), async c => {
    const u = uid(c); const b = c.req.valid('json'); await validateJournal(c, u, b); const id = newId('jr');
    await run(c.env.DB, 'INSERT INTO journal_entries (id, user_id, instrument_id, plan_id, transaction_id, title, thesis, sources, concerns, horizon, review_date, reflection) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, u, b.instrumentId ?? null, b.planId ?? null, b.transactionId ?? null, b.title, b.thesis, JSON.stringify(b.sources), b.concerns, b.horizon, b.reviewDate ?? null, b.reflection);
    return out(c, { data: { id } }, 201);
  });
  app.openapi(route('patch', '/journal/{id}', 'Journal', 'Edit an entry', { params: IdParam(), body: { content: { 'application/json': { schema: JournalBody } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); const b = c.req.valid('json');
    if (!(await first(c.env.DB, 'SELECT 1 FROM journal_entries WHERE id = ? AND user_id = ?', id, u))) throw notFound('Entry');
    await validateJournal(c, u, b);
    await run(c.env.DB, "UPDATE journal_entries SET title = ?, instrument_id = ?, plan_id = ?, transaction_id = ?, thesis = ?, sources = ?, concerns = ?, horizon = ?, review_date = ?, reflection = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?", b.title, b.instrumentId ?? null, b.planId ?? null, b.transactionId ?? null, b.thesis, JSON.stringify(b.sources), b.concerns, b.horizon, b.reviewDate ?? null, b.reflection, id, u);
    return out(c, { ok: true });
  });
  app.openapi(route('delete', '/journal/{id}', 'Journal', 'Delete an entry', { params: IdParam() }), async c => {
    const r = await run(c.env.DB, 'DELETE FROM journal_entries WHERE id = ? AND user_id = ?', c.req.valid('param').id, uid(c)); if (!(r.meta?.changes)) throw notFound('Entry');
    return out(c, { ok: true });
  });

  // ---------- Calendar & brief ----------
  async function followedIds(c: any, u: string) {
    const w = await all<{ instrument_id: string }>(c.env.DB, 'SELECT DISTINCT i.instrument_id FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE w.user_id = ?', u);
    const h = await all<{ instrument_id: string }>(c.env.DB, "SELECT DISTINCT instrument_id FROM transactions WHERE user_id = ? AND instrument_id IS NOT NULL", u);
    return [...new Set([...w, ...h].map(r => r.instrument_id))];
  }
  app.openapi(route('get', '/calendar', 'Calendar', 'Events for what you follow, plus your plan and journal review dates', { query: z.object({ from: DateStr.optional(), to: DateStr.optional() }) }), async c => {
    const u = uid(c); const m = market(); const q = c.req.valid('query');
    const from = q.from ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), to = q.to ?? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw badRequest('The calendar range is limited to one year.');
    const ev = (await Promise.all((await followedIds(c, u)).map(id => m.events(id)))).flat().filter(e => e.date >= from && e.date <= to).map(e => ({ ...e, source: 'market' }));
    const plans = (await all<any>(c.env.DB, "SELECT * FROM plans WHERE user_id = ? AND status = 'active' AND next_review BETWEEN ? AND ?", u, from, to)).map(p => ({ id: `plan:${p.id}`, instrumentId: p.instrument_id, type: 'plan_review', date: p.next_review, confirmed: true, title: `Review plan: ${p.name}`, source: 'you' }));
    const journal = (await all<any>(c.env.DB, 'SELECT * FROM journal_entries WHERE user_id = ? AND review_date BETWEEN ? AND ?', u, from, to)).map(j => ({ id: `journal:${j.id}`, instrumentId: j.instrument_id, type: 'journal_review', date: j.review_date, confirmed: true, title: `Revisit: ${j.title}`, source: 'you' }));
    return out(c, { data: [...ev, ...plans, ...journal].sort((a, b) => a.date.localeCompare(b.date)), from, to });
  });
  app.openapi(route('get', '/brief', 'Calendar', 'Your Market Brief'), async c => {
    const u = uid(c); const m = market(); const ids = await followedIds(c, u);
    const quotes = (await Promise.all(ids.map(id => m.quote(id).catch(() => null)))).filter(Boolean);
    const moves = quotes.filter(q => Math.abs(Number(q!.changePct)) >= 2).sort((a, b) => Math.abs(Number(b!.changePct)) - Math.abs(Number(a!.changePct))).slice(0, 6);
    const alerts = await all<any>(c.env.DB, 'SELECT * FROM alert_events WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10', u, new Date(Date.now() - 3 * 86400000).toISOString());
    const today = new Date().toISOString().slice(0, 10), week = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const upcoming = (await Promise.all(ids.map(id => m.events(id)))).flat().filter(e => e.date >= today && e.date <= week).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    const news = (await m.news(ids.length ? ids.slice(0, 12) : null)).slice(0, 6);
    return out(c, { data: { generatedAt: new Date().toISOString(), moves: moves.map(q => ({ instrumentId: q!.instrumentId, changePct: q!.changePct, observedAt: q!.meta.observedAt })), alerts: alerts.map(a => ({ id: a.id, instrumentId: a.instrument_id, message: a.message, observedAt: a.observed_at })), upcoming, news, provenance: m.provider.info.provenance, note: 'Every item lists when it was observed. Moves are compared with the previous close.' } });
  });

  // ---------- Connections ----------
  app.openapi(route('get', '/connections', 'Connections', 'Read-only account connections and their sync status'), async c => {
    const rows = await all(c.env.DB, 'SELECT * FROM connections WHERE user_id = ?', uid(c));
    return out(c, { data: rows, providers: [], configured: false, note: 'No account-aggregation provider is configured yet, so linking a brokerage or bank isn\'t available. Markets will only ever use provider-hosted, read-only authorization and never asks for banking passwords. Coverage for Canadian institutions such as Wealthsimple and Questrade hasn\'t been verified. Use manual entry or CSV import meanwhile.' });
  });

  // ---------- Community portfolios ----------
  app.openapi(route('get', '/community/portfolios', 'Community', 'Portfolios people share (percentages only), plus labelled samples', { query: z.object({ filter: z.enum(['all', 'following']).default('all') }) }), async c => {
    const u = uid(c); const m = market(); const f = c.req.valid('query').filter;
    const follows = new Set((await all<{ portfolio_id: string }>(c.env.DB, 'SELECT portfolio_id FROM portfolio_follows WHERE user_id = ?', u)).map(r => r.portfolio_id));
    const counts = new Map((await all<{ portfolio_id: string; n: number }>(c.env.DB, 'SELECT portfolio_id, COUNT(*) AS n FROM portfolio_follows GROUP BY portfolio_id')).map(r => [r.portfolio_id, r.n]));
    const rows = await all<any>(c.env.DB, 'SELECT s.*, p.handle, p.display_name FROM shared_portfolios s JOIN profiles p ON p.user_id = s.user_id ORDER BY s.updated_at DESC LIMIT 60');
    const mine = await viewerHoldings(c.env.DB, u);
    const shared = (await Promise.all(rows.map(r => sharedView(c.env.DB, m, r).catch(() => null)))).filter(Boolean) as any[];
    const all_ = [...shared.map(x => ({ ...x, isMine: rows.find(r => r.portfolio_id === x.id)?.user_id === u })), ...SAMPLE_PORTFOLIOS.map(x => ({ ...sampleView(m, x), isMine: false }))]
      .map(x => ({ ...x, following: follows.has(x.id), followers: counts.get(x.id) ?? 0, youAlsoHold: x.holdings.filter((h: any) => mine.has(h.instrumentId)).map((h: any) => h.symbol) }))
      .filter(x => f === 'all' || x.following);
    return out(c, { data: all_, note: 'Shared portfolios show percentages only. Markets doesn\'t rank portfolios by returns, and how someone invests isn\'t advice for you. Manually entered holdings aren\'t verified.' });
  });
  app.openapi(route('post', '/community/portfolios/{id}/follow', 'Community', 'Follow or unfollow a shared portfolio', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param');
    if (!SAMPLE_PORTFOLIOS.some(x => x.id === id) && !(await sharedRow(c.env.DB, id))) throw notFound('Shared portfolio');
    const has = await first(c.env.DB, 'SELECT 1 FROM portfolio_follows WHERE user_id = ? AND portfolio_id = ?', u, id);
    await run(c.env.DB, has ? 'DELETE FROM portfolio_follows WHERE user_id = ? AND portfolio_id = ?' : 'INSERT INTO portfolio_follows (user_id, portfolio_id) VALUES (?, ?)', u, id);
    return out(c, { ok: true, following: !has });
  });
  app.openapi(route('get', '/portfolios/{id}/share', 'Community', 'How this portfolio is shared, and a preview of what others would see', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); const p = await ownedPortfolio(c.env.DB, u, id);
    const row = await sharedRow(c.env.DB, id);
    const profile = await first<any>(c.env.DB, 'SELECT handle, display_name FROM profiles WHERE user_id = ?', u);
    const preview = await sharedView(c.env.DB, market(), { portfolio_id: id, user_id: u, title: row?.title ?? p.name, note: row?.note ?? '', show_holdings: row ? row.show_holdings : 1, handle: profile?.handle, display_name: profile?.display_name });
    return out(c, { data: { shared: Boolean(row), canShare: p.kind === 'manual' || p.kind === 'connected', reason: p.kind === 'demo' ? 'The demo portfolio has made-up holdings, so it can\'t be shared.' : null, title: row?.title ?? p.name, note: row?.note ?? '', showHoldings: row ? row.show_holdings === 1 : true, handle: profile?.handle ?? null, preview } });
  });
  app.openapi(route('put', '/portfolios/{id}/share', 'Community', 'Share this portfolio (percentages only)', { params: IdParam(), body: { content: { 'application/json': { schema: z.object({ title: z.string().trim().min(1).max(60), note: z.string().max(280).default(''), showHoldings: z.boolean().default(true), handle: z.string().regex(/^[a-z0-9_]{3,20}$/, 'Use 3 to 20 lowercase letters, numbers or underscores.') }) } } } }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); const b = c.req.valid('json'); const p = await ownedPortfolio(c.env.DB, u, id);
    if (c.get('isAnonymous')) throw new ApiError(403, 'forbidden', 'Create an account to share a portfolio.');
    if (p.kind === 'demo') throw new ApiError(403, 'forbidden', 'The demo portfolio has made-up holdings, so it can\'t be shared.');
    if (b.handle.startsWith('sample')) throw badRequest('That handle is reserved.');
    const taken = await first(c.env.DB, 'SELECT 1 FROM profiles WHERE handle = ? AND user_id != ?', b.handle, u);
    if (taken) throw new ApiError(409, 'conflict', 'That handle is taken.');
    await c.env.DB.batch([
      stmt(c.env.DB, 'UPDATE profiles SET handle = ? WHERE user_id = ?', b.handle, u),
      stmt(c.env.DB, "INSERT INTO shared_portfolios (portfolio_id, user_id, title, note, show_holdings) VALUES (?, ?, ?, ?, ?) ON CONFLICT(portfolio_id) DO UPDATE SET title = excluded.title, note = excluded.note, show_holdings = excluded.show_holdings, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')", id, u, b.title, b.note, b.showHoldings ? 1 : 0),
    ]);
    return out(c, { ok: true, shared: true });
  });
  app.openapi(route('delete', '/portfolios/{id}/share', 'Community', 'Stop sharing this portfolio', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param'); await ownedPortfolio(c.env.DB, u, id);
    await c.env.DB.batch([stmt(c.env.DB, 'DELETE FROM shared_portfolios WHERE portfolio_id = ? AND user_id = ?', id, u), stmt(c.env.DB, 'DELETE FROM portfolio_follows WHERE portfolio_id = ?', id)]);
    return out(c, { ok: true, shared: false });
  });

  // ---------- Community (labelled examples) ----------
  app.openapi(route('get', '/community/posts', 'Community', 'Discussions (labelled examples during the beta)', { query: z.object({ instrumentId: z.string().optional() }) }), async c => {
    const u = uid(c); const q = c.req.valid('query');
    const marks = new Set((await all<{ post_id: string }>(c.env.DB, 'SELECT post_id FROM bookmarks WHERE user_id = ?', u)).map(r => r.post_id));
    return out(c, { data: DEMO_POSTS.filter(p => !q.instrumentId || p.instrumentIds.includes(q.instrumentId)).map(p => ({ ...p, bookmarked: marks.has(p.id), provenance: 'demo' })), posting: { open: false, reason: 'Posting opens once reporting, blocking and moderation are running. These are sample discussions.' } });
  });
  app.openapi(route('post', '/community/posts/{id}/bookmark', 'Community', 'Bookmark or un-bookmark a post', { params: IdParam() }), async c => {
    const u = uid(c); const { id } = c.req.valid('param');
    if (!DEMO_POSTS.some(p => p.id === id)) throw notFound('Post');
    const has = await first(c.env.DB, 'SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?', u, id);
    await run(c.env.DB, has ? 'DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?' : 'INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)', u, id);
    return out(c, { ok: true, bookmarked: !has });
  });

  return app;
}
