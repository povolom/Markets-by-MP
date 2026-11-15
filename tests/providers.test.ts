// Live-provider behaviour with the network replaced by fixtures: which source serves what,
// what outside API clients may see, and that a failing provider never falls back to demo data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/server/app';
import { setFetcher } from '../src/server/providers/fetch-cache';
import { addUser, createTestDb } from './d1-shim';

const env = { DB: createTestDb(), BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://localhost', ENVIRONMENT: 'test' };
const { app } = createApi(async c => { const u = c.req.header('x-test-user'); return u ? { userId: u, isAnonymous: c.req.header('x-test-guest') === '1' } : null; });
let failCoinGecko = false;

const day = (n: number) => new Date(Date.now() - n * 86400000);
beforeAll(() => setFetcher(async url => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('coingecko')) {
    if (failCoinGecko) return new Response('{}', { status: 500 });
    if (url.includes('/coins/markets')) return json([{ id: 'bitcoin', current_price: 64000, market_cap: 1.27e12, high_24h: 65000, low_24h: 63000, price_change_percentage_24h: -1.5, last_updated: new Date().toISOString() }]);
    if (url.includes('/market_chart')) return json({ prices: Array.from({ length: 40 }, (_, i) => [day(39 - i).getTime(), 60000 + i * 100]), total_volumes: Array.from({ length: 40 }, (_, i) => [day(39 - i).getTime(), 1e10]) });
  }
  if (url.includes('data.alpaca.markets')) {
    if (url.includes('/snapshots')) return json({ SOFI: { latestTrade: { t: new Date().toISOString(), p: 21.37 }, dailyBar: { t: new Date().toISOString(), o: 21, h: 21.6, l: 20.9, c: 21.37, v: 1e6 }, prevDailyBar: { t: day(1).toISOString(), c: 21.0 } } });
    if (url.includes('/bars')) return json({ bars: { SOFI: Array.from({ length: 30 }, (_, i) => ({ t: day(40 - i).toISOString(), o: 20, h: 22, l: 19, c: 20 + i / 10, v: 1e6 })) }, next_page_token: null });
  }
  if (url.includes('eodhd.com')) {
    if (url.includes('/real-time/')) return json([{ code: 'SHOP.TO', timestamp: Math.floor(Date.now() / 1000) - 900, open: 150, high: 152, low: 149, close: 151.25, volume: 1e6, previousClose: 150, change: 1.25, change_p: 0.83 }, { code: 'GSPC.INDX', timestamp: Math.floor(Date.now() / 1000), open: 6000, high: 6010, low: 5990, close: 6005, volume: 0, previousClose: 6000, change: 5, change_p: 0.08 }]);
    if (url.includes('/eod/')) return json(Array.from({ length: 30 }, (_, i) => ({ date: day(40 - i).toISOString().slice(0, 10), open: 140, high: 150, low: 139, close: 140 + i / 2, adjusted_close: 139 + i / 2, volume: 1e6 })));
    if (url.includes('/div/')) return json([{ date: '2026-08-01', paymentDate: '2026-08-15', value: 0.25, currency: 'CAD' }]);
  }
  if (url.includes('questrade.com')) {
    if (url.includes('/v1/symbols?names=')) return json({ symbols: [{ symbol: 'GSY.TO', symbolId: 101, prevDayClosePrice: 180, highPrice52: 200, lowPrice52: 120, currency: 'CAD' }, { symbol: 'SOFI', symbolId: 202, prevDayClosePrice: 21, highPrice52: 25, lowPrice52: 8, currency: 'USD' }] });
    if (url.includes('/v1/markets/quotes')) return json({ quotes: [{ symbol: url.includes('ids=101') ? 'GSY.TO' : 'SOFI', symbolId: url.includes('ids=101') ? 101 : 202, lastTradePrice: url.includes('ids=101') ? 183.6 : 21.5, lastTradeTime: new Date().toISOString(), highPrice: 0, lowPrice: 0, delay: 15 }] });
    if (url.includes('/v1/markets/candles/')) return json({ candles: Array.from({ length: 30 }, (_, i) => ({ start: day(40 - i).toISOString(), end: day(40 - i).toISOString(), open: 170, high: 185, low: 168, close: 170 + i / 2, volume: 1e5 })) });
  }
  if (url.includes('alphavantage.co')) {
    const series: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) series[day(40 - i).toISOString().slice(0, 10)] = { '1. open': '30', '2. high': '31', '3. low': '29', '4. close': String(30 + i / 10), '5. volume': '1000' };
    return json({ 'Meta Data': {}, 'Time Series (Daily)': series });
  }
  if (url.includes('frankfurter')) {
    const rates: Record<string, Record<string, number>> = {};
    for (let i = 10; i >= 1; i--) rates[day(i).toISOString().slice(0, 10)] = { CAD: 1.40 + i / 1000, EUR: 0.9, GBP: 0.78, JPY: 150, AUD: 1.5, CHF: 0.88, MXN: 18, CNY: 7.2, INR: 84 };
    return json({ base: 'USD', rates });
  }
  return new Response('not found', { status: 404 });
}));
afterAll(() => setFetcher(null));

const get = async (path: string, appRequest: boolean, user?: string) => {
  const res = await app.request(path, { headers: { 'cf-connecting-ip': `10.9.0.${Math.floor(Math.random() * 250)}`, ...(appRequest ? { 'sec-fetch-site': 'same-origin' } : {}), ...(user ? { 'x-test-user': user } : {}) } }, env);
  return { status: res.status, body: await res.json() as any };
};
const send = async (method: string, path: string, user: string, body?: unknown, guest = false) => {
  const res = await app.request(path, { method, headers: { 'cf-connecting-ip': '10.9.1.1', 'x-test-user': user, 'content-type': 'application/json', ...(guest ? { 'x-test-guest': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined }, env);
  return { status: res.status, body: await res.json() as any };
};

describe('live providers', () => {
  it('serves real crypto to the app, credited to CoinGecko', async () => {
    const r = await get('/api/v1/assets/crypto.btc-usd/quote', true);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ price: '64000.00', changePct: '-1.50', meta: { provider: 'coingecko', provenance: 'production' } });
  });
  it("doesn't redistribute CoinGecko data to outside API clients", async () => {
    const r = await get('/api/v1/assets/crypto.btc-usd/quote', false);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('not_licensed');
    const s = await get('/api/v1/assets/search?q=bitcoin&limit=5', false);
    expect(s.body.data.every((i: any) => i.assetClass !== 'crypto')).toBe(true);
  });
  it('serves real ECB exchange rates to everyone', async () => {
    const r = await get('/api/v1/assets/fx.usdcad/quote', false);
    expect(r.status).toBe(200);
    expect(r.body.data.meta.provider).toBe('ecb');
    expect(r.body.data.price).toBe('1.401');
    const fx = await get('/api/v1/fx?from=USD&to=EUR', false);
    expect(fx.body.data.rate).toBe('0.9');
    expect(fx.body.meta.provider).toBe('ecb');
  });
  it('keeps curated stocks on labelled demo data and locks the rest', async () => {
    const curated = await get('/api/v1/assets/xnas.aapl/quote', true);
    expect(curated.body.data.meta.provenance).toBe('demo');
    const us = await get('/api/v1/assets/xnas.sofi/quote', true);
    expect(us.status).toBe(403);
    expect(us.body.error.code).toBe('locked');
    const batch = await get('/api/v1/quotes?ids=xnas.aapl,xnas.sofi,xtse.gsy', true);
    expect(batch.status).toBe(200);
    expect(batch.body.data.map((q: any) => q.locked ?? false)).toEqual([false, true, true]);
    expect(batch.body.data[2].lockReason).toBe('needs_key');
  });
  it('returns an error, never demo data, when a real provider fails', async () => {
    failCoinGecko = true;
    const r = await get('/api/v1/assets/crypto.sol-usd/quote', true);
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('upstream_error');
    failCoinGecko = false;
  });
});

describe('listing universe', () => {
  const top = async (q: string) => (await get(`/api/v1/assets/search?q=${encodeURIComponent(q)}&limit=3`, true)).body.data.map((i: any) => i.id);
  it('finds listings beyond the curated catalogue', async () => {
    expect((await top('sofi'))[0]).toBe('xnas.sofi');
    expect((await top('palantir'))[0]).toBe('xnas.pltr');
    expect((await top('berkshire'))[0]).toBe('xnys.brk.b');
    expect((await top('dogecoin'))[0]).toBe('crypto.doge-usd');
    expect((await top('brookfield'))).toContain('xtse.bn');
  });
  it('reports coverage of thousands of instruments', async () => {
    const r = await get('/api/v1/coverage', true);
    expect(r.body.instrumentCount).toBeGreaterThan(10000);
  });
});

describe('personal data keys', () => {
  beforeAll(() => { addUser(env.DB as any, 'kim'); addUser(env.DB as any, 'lee'); addUser(env.DB as any, 'g1', true); });
  it('stores a key encrypted, never returns it, and unlocks real US prices for that user only', async () => {
    expect((await send('PUT', '/api/v1/data-keys/alpaca', 'g1', { keyId: 'TESTKEY0000001', secret: 'TESTSECRET00000000000000' }, true)).status).toBe(403);
    const put = await send('PUT', '/api/v1/data-keys/alpaca', 'kim', { keyId: 'TESTKEY0000001', secret: 'TESTSECRET00000000000000' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ provider: 'alpaca', hint: '0001', status: 'ok' });
    expect(JSON.stringify((await get('/api/v1/data-keys', true, 'kim')).body)).not.toContain('TESTSECRET');
    const row = (env.DB as any).prepare('SELECT ciphertext FROM data_connections WHERE user_id = ?').bind('kim');
    expect(JSON.stringify(await row.first())).not.toContain('TESTSECRET');
    const mine = await get('/api/v1/assets/xnas.sofi/quote', true, 'kim');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toMatchObject({ price: '21.37', previousClose: '21.00', meta: { provider: 'alpaca', provenance: 'production' } });
    const hist = await get('/api/v1/assets/xnas.sofi/history?range=3M', true, 'kim');
    expect(hist.body.data.length).toBeGreaterThan(20);
    expect((await get('/api/v1/assets/xnas.sofi/quote', true, 'lee')).status).toBe(403);
    expect((await send('DELETE', '/api/v1/data-keys/alpaca', 'kim')).status).toBe(200);
    expect((await get('/api/v1/assets/xnas.sofi/quote', true, 'kim')).status).toBe(403);
  });
});

describe('one key for every exchange (EODHD)', () => {
  beforeAll(() => { addUser(env.DB as any, 'ana'); });
  it('unlocks Canadian listings and indexes with real prices and dividends', async () => {
    expect((await get('/api/v1/assets/xtse.gsy/quote', true, 'ana')).status).toBe(403);
    const put = await send('PUT', '/api/v1/data-keys/eodhd', 'ana', { token: 'TESTTOKEN-PAID-12345678' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ provider: 'eodhd', hint: '5678', meta: { dailyLimit: 100000 } });
    const shop = await get('/api/v1/assets/xtse.shop/quote', true, 'ana');
    expect(shop.body.data).toMatchObject({ price: '151.25', previousClose: '150.00', currency: 'CAD', meta: { provider: 'eodhd' } });
    const spx = await get('/api/v1/assets/index.spx/quote', true, 'ana');
    expect(spx.body.data.meta.provider).toBe('eodhd');
    const divs = await get('/api/v1/assets/xtse.shop/dividends', true, 'ana');
    expect(divs.body.data[0]).toMatchObject({ exDate: '2026-08-01', amount: '0.25', status: 'paid' });
    const hist = await get('/api/v1/assets/xtse.shop/history?range=3M', true, 'ana');
    expect(hist.body.data.at(-1)).toMatchObject({ close: '154.5', adjClose: '153.5' });
  });
});

describe('Questrade and smart routing', () => {
  beforeAll(() => { addUser(env.DB as any, 'qt'); });
  it('unlocks Canadian listings through a Questrade token and routes each asset to the best key', async () => {
    const put = await send('PUT', '/api/v1/data-keys/questrade', 'qt', { token: 'TESTQUESTRADETOKEN1' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ provider: 'questrade', status: 'ok' });
    const gsy = await get('/api/v1/assets/xtse.gsy/quote', true, 'qt');
    expect(gsy.status).toBe(200);
    expect(gsy.body.data).toMatchObject({ price: '183.60', previousClose: '180.00', currency: 'CAD', meta: { provider: 'questrade', delaySeconds: 900 } });
    // US goes to Questrade too when it's the only key.
    expect((await get('/api/v1/assets/xnas.sofi/quote', true, 'qt')).body.data.meta.provider).toBe('questrade');
    // Adding Alpaca moves US stocks to Alpaca; Canada stays on Questrade.
    await send('PUT', '/api/v1/data-keys/alpaca', 'qt', { keyId: 'TESTKEY0000002', secret: 'TESTSECRET00000000000000' });
    expect((await get('/api/v1/assets/xnas.sofi/quote', true, 'qt')).body.data.meta.provider).toBe('alpaca');
    expect((await get('/api/v1/assets/xtse.gsy/quote', true, 'qt')).body.data.meta.provider).toBe('questrade');
    const hist = await get('/api/v1/assets/xtse.gsy/history?range=3M', true, 'qt');
    expect(hist.body.data.length).toBeGreaterThan(20);
  });
  it('links TSX companies to their New York listing', async () => {
    const r = await get('/api/v1/assets/xtse.cnr', true);
    expect(r.body.data.otherListings).toContain('xnys.cni');
  });
});

describe('Alpha Vantage', () => {
  beforeAll(() => { addUser(env.DB as any, 'av'); });
  it('serves Canadian daily prices from one call per stock per day', async () => {
    const put = await send('PUT', '/api/v1/data-keys/alphavantage', 'av', { apiKey: 'TESTAVKEY123' });
    expect(put.status).toBe(200);
    const q = await get('/api/v1/assets/xtse.gsy/quote', true, 'av');
    expect(q.status).toBe(200);
    expect(q.body.data).toMatchObject({ price: '32.90', previousClose: '32.80', currency: 'CAD', meta: { provider: 'alphavantage' } });
    expect((await get('/api/v1/assets/xtse.gsy/history?range=3M', true, 'av')).body.data.length).toBeGreaterThan(20);
  });
});
