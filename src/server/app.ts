// The Markets API application. The web app and any other client use exactly these routes.
import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';
import { ApiError, errorResponse } from './http';
import { createMarket, type Market } from './market';
import { audienceOf, edgeCache, publicCors, rateLimit, requestId, sameOrigin } from './middleware';
import { getRegistry, withPersonal, type Registry } from './providers/registry';
import { alpacaInfo, createAlpaca } from './providers/alpaca';
import { createEodhd, eodhdInfo } from './providers/eodhd';
import { createQuestrade, questradeInfo } from './providers/questrade';
import { loadQuestrade, markInvalid, updateQuestrade, userKeys } from './data-keys';
import { CHANGELOG, publicRoutes } from './routes/public';
import { privateRoutes } from './routes/private';

export type SessionResolver = (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => Promise<{ userId: string; isAnonymous: boolean } | null>;

const PUBLIC_PATHS = ['/api/v1/status', '/api/v1/coverage', '/api/v1/changelog', '/api/v1/assets/*', '/api/v1/quotes', '/api/v1/markets/*', '/api/v1/news', '/api/v1/screeners/*', '/api/v1/fx', '/api/v1/openapi.json'];

export function createApi(resolveSession: SessionResolver) {
  let markets: { app: Market; api: Market; registry: Registry } | null = null;
  const personal = new Map<string, { sig: string; m: Market }>();
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return errorResponse(c, new ApiError(400, 'bad_request', 'Some fields are missing or invalid.', result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))));
    },
  });
  const getMarkets = (env: AppEnv['Bindings']) => (markets ??= (() => {
    const r = getRegistry(env);
    return { registry: r, app: createMarket(r.market, r.providers, { audience: 'app', sourceOf: r.sourceOf }), api: createMarket(r.market, r.providers, { audience: 'api', sourceOf: r.sourceOf }) };
  })());
  const getMarket = (env: AppEnv['Bindings']) => getMarkets(env).app;
  /** The market a signed-in user sees: the shared one, plus their own data key for US stocks if they connected one. */
  const marketFor = async (env: AppEnv['Bindings'], userId: string | null, opts: { scheduled?: boolean } = {}): Promise<Market> => {
    const ms = getMarkets(env);
    if (!userId) return ms.app;
    const keys = await userKeys(env.DB, env.DATA_KEY_SECRET ?? env.BETTER_AUTH_SECRET, userId).catch(() => ({}) as Awaited<ReturnType<typeof userKeys>>);
    // Scheduled alert checks skip keys on very small daily allowances (EODHD's free plan), so the cron
    // doesn't use up calls the person needs for browsing. "Check my rules now" still uses the key.
    const eodhd = keys.eodhd && !(opts.scheduled && keys.eodhd.dailyLimit != null && keys.eodhd.dailyLimit <= 100) ? keys.eodhd : undefined;
    if (!keys.alpaca && !eodhd && !keys.questrade) { personal.delete(userId); return ms.app; }
    const sig = `${keys.alpaca?.keyId ?? ''}|${eodhd?.token.slice(-8) ?? ''}|${keys.questrade ? 'q' : ''}`;
    const hit = personal.get(userId); if (hit && hit.sig === sig) return hit.m;
    const r = ms.registry;
    const reset = (p: 'alpaca' | 'eodhd' | 'questrade') => () => { void markInvalid(env.DB, userId, p); personal.delete(userId); };
    const secret = env.DATA_KEY_SECRET ?? env.BETTER_AUTH_SECRET;
    const questrade = keys.questrade && createQuestrade(userId, keys.questrade, { persist: s => updateQuestrade(env.DB, secret, userId, s), reload: () => loadQuestrade(env.DB, secret, userId), onInvalid: reset('questrade') });
    const m = createMarket(withPersonal(r.market, { alpaca: keys.alpaca && createAlpaca(keys.alpaca, reset('alpaca')), eodhd: eodhd && createEodhd(eodhd.token, reset('eodhd')), questrade }),
      [...r.providers, ...(keys.alpaca ? [alpacaInfo] : []), ...(eodhd ? [eodhdInfo] : []), ...(questrade ? [questradeInfo] : [])], { audience: 'app', sourceOf: id => r.sourceOf(id), namespace: `u:${userId}` });
    if (personal.size > 500) personal.clear();
    if (!opts.scheduled) personal.set(userId, { sig, m });
    return m;
  };

  app.use('*', requestId);
  app.onError((e, c) => errorResponse(c, e));
  app.notFound(c => errorResponse(c, new ApiError(404, 'not_found', 'No such endpoint. See /api/v1/docs.')));

  app.use('/api/v1/*', async (c, next) => {
    getMarkets(c.env);
    const s = await resolveSession(c);
    c.set('userId', s?.userId ?? null); c.set('isAnonymous', s?.isAnonymous ?? false);
    c.set('market', await marketFor(c.env, s?.userId ?? null));
    await next();
  });
  for (const p of PUBLIC_PATHS) app.use(p, publicCors);
  app.use('/api/v1/*', rateLimit);
  for (const p of ['/api/v1/assets/*', '/api/v1/markets/*', '/api/v1/screeners/*', '/api/v1/coverage']) app.use(p, edgeCache(60));
  app.use('/api/v1/*', sameOrigin);

  // Public routes serve the app and outside clients from the same URLs; each gets what it may see.
  app.route('/api/v1', publicRoutes(c => audienceOf(c) === 'api' ? markets!.api : (c.get('market') ?? markets!.app)));
  app.route('/api/v1', privateRoutes(c => c?.get('market') ?? markets!.app));

  app.openAPIRegistry.registerComponent('securitySchemes', 'session', { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Session cookie set by signing in on markets.marcantoniopovolo.com. Private endpoints are same-origin only; third-party access to private data will use explicit, scoped consent (not yet available).' });
  app.doc31('/api/v1/openapi.json', c => ({
    openapi: '3.1.0',
    info: {
      title: 'Markets API', version: CHANGELOG[0].version,
      description: 'The investing API behind Markets by MP. Public market-data endpoints are keyless within the documented limits (120 requests a minute per IP, 600 when signed in). Private endpoints need a signed-in session and only ever return your own data. **Stock, ETF, fund and index prices are generated demo data** until a licensed feed is connected. FX rates are real European Central Bank reference rates. Real crypto prices (CoinGecko) appear in the Markets app only; their terms do not allow redistribution here. Every response says where its data came from and when.',
      license: { name: 'MIT (code)', url: 'https://github.com/povolom/Markets-by-MP/blob/main/LICENSE' },
    },
    servers: [{ url: new URL(c.req.url).origin }],
    tags: [{ name: 'Market data', description: 'Keyless public endpoints.' }, { name: 'Service' }, { name: 'Account' }, { name: 'Watchlists' }, { name: 'Portfolios' }, { name: 'Transactions' }, { name: 'Alerts' }, { name: 'Dip Radar' }, { name: 'Plans' }, { name: 'Journal' }, { name: 'Calendar' }, { name: 'Connections' }, { name: 'Community' }],
  }));
  app.get('/api/v1/docs', Scalar({ url: '/api/v1/openapi.json', pageTitle: 'Markets API reference', theme: 'kepler' } as any));
  return { app, getMarket, marketFor };
}
