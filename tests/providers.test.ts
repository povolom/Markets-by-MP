// Live-provider behaviour with the network replaced by fixtures: which source serves what,
// what outside API clients may see, and that a failing provider never falls back to demo data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/server/app';
import { setFetcher } from '../src/server/providers/fetch-cache';
import { createTestDb } from './d1-shim';

const env = { DB: createTestDb(), BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://localhost', ENVIRONMENT: 'test' };
const { app } = createApi(async () => null);
let failCoinGecko = false;

const day = (n: number) => new Date(Date.now() - n * 86400000);
beforeAll(() => setFetcher(async url => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('coingecko')) {
    if (failCoinGecko) return new Response('{}', { status: 500 });
    if (url.includes('/coins/markets')) return json([{ id: 'bitcoin', current_price: 64000, market_cap: 1.27e12, high_24h: 65000, low_24h: 63000, price_change_percentage_24h: -1.5, last_updated: new Date().toISOString() }]);
    if (url.includes('/market_chart')) return json({ prices: Array.from({ length: 40 }, (_, i) => [day(39 - i).getTime(), 60000 + i * 100]), total_volumes: Array.from({ length: 40 }, (_, i) => [day(39 - i).getTime(), 1e10]) });
  }
  if (url.includes('frankfurter')) {
    const rates: Record<string, Record<string, number>> = {};
    for (let i = 10; i >= 1; i--) rates[day(i).toISOString().slice(0, 10)] = { CAD: 1.40 + i / 1000, EUR: 0.9, GBP: 0.78, JPY: 150, AUD: 1.5, CHF: 0.88, MXN: 18, CNY: 7.2, INR: 84 };
    return json({ base: 'USD', rates });
  }
  return new Response('not found', { status: 404 });
}));
afterAll(() => setFetcher(null));

const get = async (path: string, appRequest: boolean) => {
  const res = await app.request(path, { headers: { 'cf-connecting-ip': `10.9.0.${Math.floor(Math.random() * 250)}`, ...(appRequest ? { 'sec-fetch-site': 'same-origin' } : {}) } }, env);
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
  it('keeps stocks on clearly labelled demo data', async () => {
    const r = await get('/api/v1/assets/xnas.sofi/quote', false);
    expect(r.status).toBe(200);
    expect(r.body.data.meta.provenance).toBe('demo');
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
