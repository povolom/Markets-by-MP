import { beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/server/app';
import { addUser, createTestDb } from './d1-shim';
import { memoryLimit } from '../src/server/middleware';

const db = createTestDb();
const env = { DB: db, BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://localhost', ENVIRONMENT: 'test' };
// Tests resolve the session from headers; production uses Better Auth (src/worker.ts).
const { app } = createApi(async c => { const u = c.req.header('x-test-user'); return u ? { userId: u, isAnonymous: c.req.header('x-test-guest') === '1' } : null; });

let ip = 0;
async function call(method: string, path: string, opts: { user?: string; guest?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'cf-connecting-ip': `10.0.0.${++ip % 250}` };
  if (opts.user) headers['x-test-user'] = opts.user;
  if (opts.guest) headers['x-test-guest'] = '1';
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }, env);
  return { status: res.status, body: await res.json() as any, headers: res.headers };
}

beforeAll(() => { addUser(db, 'alice'); addUser(db, 'bob'); addUser(db, 'guest1', true); });

describe('public market data', () => {
  it('returns normalized instruments and quotes with provenance', async () => {
    const r = await call('GET', '/api/v1/assets/xnas.aapl/quote');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ instrumentId: 'xnas.aapl', currency: 'USD', meta: { provider: 'demo', provenance: 'demo' } });
    expect(r.body.data.price).toMatch(/^\d+\.\d+$/);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('search paginates', async () => {
    const r = await call('GET', '/api/v1/assets/search?q=&limit=5');
    expect(r.body.data).toHaveLength(5);
    expect(r.body.pagination.nextCursor).toBeTruthy();
    const next = await call('GET', `/api/v1/assets/search?q=&limit=5&cursor=${r.body.pagination.nextCursor}`);
    expect(next.body.data[0].id).not.toBe(r.body.data[0].id);
  });
  it('bounds history ranges and validates input', async () => {
    expect((await call('GET', '/api/v1/assets/xnas.aapl/history?from=2010-01-01&to=2026-01-01')).body.error.code).toBe('bad_request');
    const r = await call('GET', '/api/v1/assets/xnas.aapl/history?range=1M');
    expect(r.status).toBe(200); expect(r.body.data.length).toBeGreaterThan(15); expect(r.body.data.length).toBeLessThan(25);
    expect((await call('GET', '/api/v1/assets/nope/quote')).status).toBe(404);
    expect((await call('GET', '/api/v1/quotes?ids=' + Array(51).fill(0).map((_, i) => `x${i}`).join(','))).status).toBe(400);
  });
  it('fits fields to the asset class', async () => {
    expect((await call('GET', '/api/v1/assets/crypto.btc-usd/statistics')).body.data.peRatio).toBeNull();
    expect((await call('GET', '/api/v1/assets/xtse.xeqt/financials')).body.data).toBeNull();
    expect((await call('GET', '/api/v1/assets/index.spx')).body.data.tradable).toBe(false);
  });
  it('publishes coverage with separate rights per provider', async () => {
    const r = await call('GET', '/api/v1/coverage');
    const yahoo = r.body.providers.find((p: any) => p.id === 'yahoo-research');
    expect(yahoo.rights).toMatchObject({ publicDisplay: false, apiRedistribution: false });
    expect(yahoo.usedForPublicApi).toBe(false);
  });
  it('serves an OpenAPI document', async () => {
    const r = await call('GET', '/api/v1/openapi.json');
    expect(r.body.openapi).toBe('3.1.0');
    expect(Object.keys(r.body.paths)).toContain('/api/v1/assets/{id}/history');
  });
});

describe('private endpoints', () => {
  it('require a session', async () => {
    const r = await call('GET', '/api/v1/watchlists');
    expect(r.status).toBe(401); expect(r.body.error.code).toBe('unauthorized');
  });
  it('persist watchlists and keep users apart', async () => {
    const c = await call('POST', '/api/v1/watchlists', { user: 'alice', body: { name: 'Mine', instrumentIds: ['xnas.aapl'] } });
    expect(c.status).toBe(201);
    const id = c.body.data.id;
    expect((await call('POST', `/api/v1/watchlists/${id}/items`, { user: 'alice', body: { instrumentId: 'xtse.td' } })).body.added).toBe(true);
    const list = await call('GET', '/api/v1/watchlists', { user: 'alice' });
    expect(list.body.data[0].items.map((i: any) => i.instrumentId)).toEqual(['xnas.aapl', 'xtse.td']);
    expect(list.body.data[0].items[0].sparkline.length).toBeGreaterThan(10);
    // Bob can't see, rename, add to or delete Alice's list.
    expect((await call('GET', '/api/v1/watchlists', { user: 'bob' })).body.data).toHaveLength(0);
    expect((await call('PATCH', `/api/v1/watchlists/${id}`, { user: 'bob', body: { name: 'x' } })).status).toBe(404);
    expect((await call('POST', `/api/v1/watchlists/${id}/items`, { user: 'bob', body: { instrumentId: 'xnas.msft' } })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/watchlists/${id}`, { user: 'bob' })).status).toBe(404);
  });
  it('only seeds demo data for guests', async () => {
    expect((await call('POST', '/api/v1/demo/seed', { user: 'alice' })).status).toBe(403);
    const g = await call('POST', '/api/v1/demo/seed', { user: 'guest1', guest: true });
    expect(g.body.seeded).toBe(true);
    expect((await call('POST', '/api/v1/demo/seed', { user: 'guest1', guest: true })).body.seeded).toBe(false);
    const pf = await call('GET', `/api/v1/portfolios/${g.body.portfolioId}`, { user: 'guest1' });
    expect(pf.body.data.portfolio.kind).toBe('demo');
    expect(pf.body.data.summary.holdings.length).toBeGreaterThan(3);
    expect(pf.body.data.summary.cash).not.toBeNull();
    expect((await call('GET', `/api/v1/portfolios/${g.body.portfolioId}`, { user: 'alice' })).status).toBe(404);
  });
  it('imports CSV safely: preview, commit, skip duplicates, undo', async () => {
    const p = (await call('POST', '/api/v1/portfolios', { user: 'alice', body: { name: 'TFSA' } })).body.data.id;
    const csv = 'Date,Type,Symbol,Quantity,Price,Amount,Currency\n2025-01-02,Deposit,,,,5000,CAD\n2025-01-03,Buy,XEQT.TO,10,30,,CAD\n2025-01-03,Buy,AAPL,2,200,,USD\nbad,Buy,AAPL,1,1,,USD\n';
    const prev = await call('POST', `/api/v1/portfolios/${p}/imports/preview`, { user: 'alice', body: { csv } });
    expect(prev.body.data.counts).toEqual({ ok: 3, error: 1, duplicate: 0 });
    const commit = await call('POST', `/api/v1/portfolios/${p}/imports`, { user: 'alice', body: { csv, filename: 'export.csv' } });
    expect(commit.body.data.imported).toBe(3);
    const again = await call('POST', `/api/v1/portfolios/${p}/imports/preview`, { user: 'alice', body: { csv } });
    expect(again.body.data.counts.duplicate).toBe(3);
    const s = await call('GET', `/api/v1/portfolios/${p}`, { user: 'alice' });
    expect(s.body.data.summary.holdings).toHaveLength(2);
    expect((await call('POST', `/api/v1/imports/${commit.body.data.batchId}/revert`, { user: 'bob' })).status).toBe(404);
    expect((await call('POST', `/api/v1/imports/${commit.body.data.batchId}/revert`, { user: 'alice' })).body.removed).toBe(3);
    expect((await call('GET', `/api/v1/portfolios/${p}`, { user: 'alice' })).body.data.summary.holdings).toHaveLength(0);
  });
  it('simulates without changing the portfolio', async () => {
    const p = (await call('POST', '/api/v1/portfolios', { user: 'alice', body: { name: 'Sim' } })).body.data.id;
    await call('POST', `/api/v1/portfolios/${p}/transactions`, { user: 'alice', body: { type: 'deposit', tradeDate: '2025-01-02', amount: '1000' } });
    const before = (await call('GET', `/api/v1/portfolios/${p}/transactions`, { user: 'alice' })).body.data.length;
    const w = await call('POST', `/api/v1/portfolios/${p}/what-if`, { user: 'alice', body: { type: 'buy', instrumentId: 'xtse.xeqt', amount: '500', funding: 'cash' } });
    expect(w.status).toBe(200); expect(w.body.data.notice).toMatch(/Nothing was recorded/);
    expect(Number(w.body.data.cashAfter)).toBeCloseTo(500, 0);
    expect((await call('GET', `/api/v1/portfolios/${p}/transactions`, { user: 'alice' })).body.data.length).toBe(before);
    expect((await call('POST', `/api/v1/portfolios/${p}/what-if`, { user: 'alice', body: { type: 'buy', instrumentId: 'index.spx', amount: '500' } })).status).toBe(400);
  });
  it('validates alert rules and de-duplicates alerts', async () => {
    const r = await call('POST', '/api/v1/alerts/rules', { user: 'alice', body: { scope: 'instrument', instrumentId: 'xnas.aapl', kind: 'below_rolling_high', threshold: '0.01', windowDays: 30 } });
    expect(r.status).toBe(201);
    const first = await call('POST', '/api/v1/alerts/evaluate', { user: 'alice' });
    const second = await call('POST', '/api/v1/alerts/evaluate', { user: 'alice' });
    const events = (await call('GET', '/api/v1/alerts/events', { user: 'alice' })).body.data;
    expect(second.body.data.fired).toBe(0);                    // disarmed after the first crossing
    expect(events.length).toBe(first.body.data.fired);
    expect((await call('POST', '/api/v1/alerts/rules', { user: 'alice', body: { scope: 'watchlist', kind: 'target_price', threshold: '10' } })).status).toBe(400);
    expect((await call('DELETE', `/api/v1/alerts/rules/${r.body.data.id}`, { user: 'bob' })).status).toBe(404);
  });
  it('blocks cross-origin writes', async () => {
    const res = await app.request('/api/v1/watchlists', { method: 'POST', headers: { 'x-test-user': 'alice', origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }, env);
    expect(res.status).toBe(403);
  });
  it('exports and deletes an account', async () => {
    addUser(db, 'carol');
    await call('POST', '/api/v1/watchlists', { user: 'carol', body: { name: 'C' } });
    expect((await call('GET', '/api/v1/me/export', { user: 'carol' })).body.watchlists).toHaveLength(1);
    expect((await call('DELETE', '/api/v1/me', { user: 'carol', body: { confirm: 'DELETE' } })).body.deleted).toBe(true);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM watchlists WHERE user_id = ?').bind('carol').first('n')).toBe(0);
  });
});

describe('rate limits', () => {
  it('returns 429 with retry guidance past the limit', () => {
    for (let i = 0; i < 3; i++) memoryLimit('t', 3, 60, 1000);
    const r = memoryLimit('t', 3, 60, 2000);
    expect(r.success).toBe(false); expect(r.retryAfter).toBe(59);
  });
  it('applies to keyless requests over HTTP', async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await app.request('/api/v1/status', { headers: { 'cf-connecting-ip': '192.168.1.1' } }, env)).status;
    expect(last).toBe(429);
  });
});
