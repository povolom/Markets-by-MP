// Public, keyless Markets API endpoints. Market data only; nothing here touches user data.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../env';
import { paginate, ApiError } from '../http';
import type { Market } from '../market';
import { MAX_BATCH, RANGES } from '../market';
import * as S from '../schemas';

const tags = ['Market data'];
const errs = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: S.ErrorBody } } },
  404: { description: 'Not found', content: { 'application/json': { schema: S.ErrorBody } } },
  429: { description: 'Rate limited. See the Retry-After header.', content: { 'application/json': { schema: S.ErrorBody } } },
  502: { description: 'The upstream provider failed. No substitute data is returned.', content: { 'application/json': { schema: S.ErrorBody } } },
};
const ok = <T extends z.ZodType>(schema: T, description: string) => ({ 200: { description, content: { 'application/json': { schema } } }, ...errs });
const wrap = <T extends z.ZodType>(t: T) => z.object({ data: t });

export const CHANGELOG = [
  { version: '1.0.0-beta.2', date: '2026-11-15', changes: ['Search covers every US-listed stock and ETF (Nasdaq Trader symbol directory), a curated TSX list and the top crypto: about 12,000 instruments.', 'FX rates are now real European Central Bank reference rates.', 'Crypto prices in the Markets app come from CoinGecko; they are not redistributed through this API (403 not_licensed).', 'Stock, ETF, fund and index prices remain generated demo data.'] },
  { version: '1.0.0-beta.1', date: '2026-11-15', changes: ['First public beta of the Markets API: assets, quotes, history, statistics, financials, dividends, events, news, related, market overview, dip screener, coverage and status.', 'All market data is generated demo data until a licensed provider is connected.'] },
];

export function publicRoutes(pick: (c: any) => Market) {
  const app = new OpenAPIHono<AppEnv>();
  const market = (c: any) => pick(c);
  const json = (c: any, data: unknown) => c.json(data as any, 200);

  app.openapi(createRoute({ method: 'get', path: '/status', tags: ['Service'], summary: 'Service status', responses: ok(S.Any, 'Status') }), c => {
    const m = market(c);
    return json(c, { status: 'ok', version: CHANGELOG[0].version, time: new Date().toISOString(), marketData: { provenance: m.provider.info.provenance === 'demo' ? 'demo' : 'mixed', notice: m.coverage().dataNotice, sources: m.coverage().sources }, limits: { publicPerMinute: 120, accountPerMinute: 600, maxBatch: MAX_BATCH, maxHistoryDays: 1830 } });
  });
  app.openapi(createRoute({ method: 'get', path: '/changelog', tags: ['Service'], summary: 'API changelog', responses: ok(S.Any, 'Changelog') }), c => json(c, { data: CHANGELOG }));
  app.openapi(createRoute({ method: 'get', path: '/coverage', tags: ['Service'], summary: 'Supported assets, exchanges, fields, history and data rights', responses: ok(S.Any, 'Coverage') }), c => json(c, market(c).coverage()));

  app.openapi(createRoute({
    method: 'get', path: '/assets/search', tags, summary: 'Search instruments',
    request: { query: z.object({ q: z.string().max(64).default('').openapi({ example: 'apple' }), assetClass: z.enum(['stock', 'etf', 'crypto', 'index', 'fx', 'mutual_fund']).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().optional() }) },
    responses: ok(z.object({ data: z.array(S.Instrument), pagination: S.Pagination }), 'Matching instruments'),
  }), c => { const q = c.req.valid('query'); return json(c, paginate(market(c).search(q.q, q.assetClass), q.cursor, q.limit)); });

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}', tags, summary: 'Instrument details', request: { params: S.InstrumentId }, responses: ok(wrap(S.Instrument), 'Instrument') }),
    c => json(c, { data: market(c).instrument(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/quote', tags, summary: 'Latest quote', request: { params: S.InstrumentId }, responses: ok(wrap(S.Quote), 'Quote') }),
    async c => json(c, { data: await market(c).quote(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/quotes', tags, summary: `Quotes for up to ${MAX_BATCH} instruments`, request: { query: z.object({ ids: z.string().openapi({ example: 'xnas.aapl,xtse.xeqt' }) }) }, responses: ok(z.object({ data: z.array(S.Quote) }), 'Quotes') }),
    async c => { const ids = [...new Set(c.req.valid('query').ids.split(',').map(s => s.trim()).filter(Boolean))]; return json(c, { data: await market(c).quotes(ids) }); });

  app.openapi(createRoute({
    method: 'get', path: '/assets/{id}/history', tags, summary: 'Daily price history (bounded)',
    request: { params: S.InstrumentId, query: z.object({ range: z.enum(Object.keys(RANGES) as [string, ...string[]]).optional().openapi({ description: '1M, 3M, 6M, YTD, 1Y, 5Y or MAX (five years).' }), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) },
    responses: ok(z.object({ data: z.array(S.Bar), instrumentId: z.string(), interval: z.literal('1d'), currency: z.string(), meta: S.DataMeta }), 'Bars, oldest first'),
  }), async c => {
    const { id } = c.req.valid('param'); const q = c.req.valid('query');
    const m = market(c); const inst = m.instrument(id);
    const bars = await m.history(id, q.range as any, q.from, q.to);
    return json(c, { data: bars, instrumentId: id, interval: '1d', currency: inst.currency, meta: { provider: m.provider.info.id, provenance: m.provider.info.provenance, observedAt: bars.at(-1)?.date ?? null, retrievedAt: new Date().toISOString(), delaySeconds: m.provider.info.delaySeconds, notes: ['Completed sessions only; see /quote for the current session.'] } });
  });

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/statistics', tags, summary: 'Statistics (fields depend on asset class)', request: { params: S.InstrumentId }, responses: ok(wrap(S.Statistics), 'Statistics') }),
    async c => json(c, { data: await market(c).statistics(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/financials', tags, summary: 'Financial statements (equities only)', request: { params: S.InstrumentId }, responses: ok(wrap(S.Financials.nullable()), 'Statements, or null when not applicable') }),
    async c => json(c, { data: await market(c).financials(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/dividends', tags, summary: 'Dividends paid, declared and projected', request: { params: S.InstrumentId }, responses: ok(z.object({ data: z.array(S.Dividend) }), 'Dividends') }),
    async c => json(c, { data: await market(c).dividends(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/events', tags, summary: 'Earnings, dividend and split dates', request: { params: S.InstrumentId }, responses: ok(z.object({ data: z.array(S.Event) }), 'Events') }),
    async c => json(c, { data: await market(c).events(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/news', tags, summary: 'News headlines that mention this instrument', request: { params: S.InstrumentId, query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10), cursor: z.string().optional() }) }, responses: ok(z.object({ data: z.array(S.News), pagination: S.Pagination }), 'News') }),
    async c => { const q = c.req.valid('query'); return json(c, paginate(await market(c).news([c.req.valid('param').id]), q.cursor, q.limit)); });

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/related', tags, summary: 'Similar and different instruments, with reasons', request: { params: S.InstrumentId }, responses: ok(wrap(S.Related), 'Related instruments') }),
    async c => json(c, { data: await market(c).related(c.req.valid('param').id) }));

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/composition', tags, summary: 'Fund holdings with date and coverage (funds only)', request: { params: S.InstrumentId }, responses: ok(S.Any, 'Composition or null') }),
    c => { const m = market(c); const i = m.instrument(c.req.valid('param').id); return json(c, { data: i.assetClass === 'etf' || i.assetClass === 'mutual_fund' ? m.composition(i.id) ?? null : null }); });

  app.openapi(createRoute({ method: 'get', path: '/assets/{id}/dip', tags, summary: 'Drop from a rolling high (same definition as Dip Radar)', request: { params: S.InstrumentId, query: z.object({ windowDays: z.coerce.number().int().min(5).max(365).default(30), basis: z.enum(['close', 'intraday']).default('close') }) }, responses: ok(wrap(S.DipRow), 'Snapshot') }),
    async c => { const q = c.req.valid('query'); return json(c, { data: await market(c).dipSnapshot(c.req.valid('param').id, q.windowDays, q.basis) }); });

  app.openapi(createRoute({ method: 'get', path: '/markets/overview', tags, summary: 'Benchmarks and the day\'s largest moves', responses: ok(S.Any, 'Overview') }),
    async c => json(c, { data: await market(c).overview() }));

  app.openapi(createRoute({ method: 'get', path: '/news', tags, summary: 'Market-wide headlines', request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10), cursor: z.string().optional() }) }, responses: ok(z.object({ data: z.array(S.News), pagination: S.Pagination }), 'News') }),
    async c => { const q = c.req.valid('query'); return json(c, paginate(await market(c).news(null), q.cursor, q.limit)); });

  app.openapi(createRoute({
    method: 'get', path: '/screeners/dips', tags, summary: 'Instruments below a recent high',
    description: 'Sorted by the criterion you choose. A larger decline is not a better investment; this lists facts, not recommendations.',
    request: { query: z.object({ windowDays: z.coerce.number().int().min(5).max(365).default(30), basis: z.enum(['close', 'intraday']).default('close'), minDropPct: z.coerce.number().min(0).max(90).default(5), assetClass: z.enum(['stock', 'etf', 'crypto', 'mutual_fund']).optional(), sort: z.enum(['drop', 'daily', 'symbol']).default('drop') }) },
    responses: ok(z.object({ data: z.array(S.DipRow), definition: z.string() }), 'Matches'),
  }), async c => {
    const q = c.req.valid('query');
    return json(c, { data: await market(c).dipScreener(q), definition: `Drop from the highest ${q.basis === 'close' ? 'adjusted close' : 'intraday high'} in the last ${q.windowDays} calendar days, measured on today's price basis.` });
  });

  app.openapi(createRoute({ method: 'get', path: '/fx', tags, summary: 'Exchange rate (latest or on a date)', request: { query: z.object({ from: z.string().length(3), to: z.string().length(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }, responses: ok(S.Any, 'Rate') }),
    async c => { const q = c.req.valid('query'); const m = market(c); return json(c, { data: { from: q.from.toUpperCase(), to: q.to.toUpperCase(), date: q.date ?? null, rate: await m.fx(q.from.toUpperCase(), q.to.toUpperCase(), q.date ?? null) }, meta: (() => { const ecb = m.providers.find(p => p.id === 'ecb'); const real = ecb && m.provider.info.provenance !== 'demo' && ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'MXN', 'CNY', 'INR'].includes(q.from.toUpperCase()) && ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'MXN', 'CNY', 'INR'].includes(q.to.toUpperCase()); return { provider: real ? 'ecb' : 'demo', provenance: real ? 'production' : 'demo', retrievedAt: new Date().toISOString(), notes: real ? ['European Central Bank reference rate.'] : ['Demo rate.'] }; })() }); });

  return app;
}

export { ApiError };
