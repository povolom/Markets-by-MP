import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env';
import { ApiError } from './http';

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', id);
  const started = Date.now();
  await next();
  c.res.headers.set('X-Request-Id', id);
  // Structured, redacted access log: no query strings (they may hold search terms), no cookies.
  if (c.res.status >= 500 || c.res.status === 429) console.log(JSON.stringify({ level: c.res.status >= 500 ? 'error' : 'warn', requestId: id, method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms: Date.now() - started }));
});

// Fixed-window fallback limiter for when the Workers Rate Limiting binding isn't configured (local dev, tests).
const windows = new Map<string, { start: number; count: number }>();
export function memoryLimit(key: string, limit: number, periodSec: number, now = Date.now()) {
  const w = windows.get(key);
  if (!w || now - w.start >= periodSec * 1000) { windows.set(key, { start: now, count: 1 }); return { success: true, retryAfter: 0 }; }
  w.count++;
  if (windows.size > 5000) windows.clear();
  return { success: w.count <= limit, retryAfter: Math.ceil((w.start + periodSec * 1000 - now) / 1000) };
}

export const PUBLIC_LIMIT = { perMinute: 120 };
export const ACCOUNT_LIMIT = { perMinute: 600 };

/** Keyless public access within documented limits; signed-in clients get a higher limit. */
export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('userId');
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const key = user ? `u:${user}` : `ip:${ip}`;
  const limit = user ? ACCOUNT_LIMIT.perMinute : PUBLIC_LIMIT.perMinute;
  let ok = true, retry = 60;
  if (c.env.API_LIMITER && !user) ok = (await c.env.API_LIMITER.limit({ key })).success;
  else { const r = memoryLimit(key, limit, 60); ok = r.success; retry = r.retryAfter || 60; }
  c.header('X-RateLimit-Limit', String(limit));
  if (!ok) throw new ApiError(429, 'rate_limited', `Too many requests. The limit is ${limit} a minute${user ? '' : ' without an account'}. Try again in ${retry} seconds.`, { limitPerMinute: limit }, retry);
  await next();
});

/** Public market data: open to any origin, never with credentials. */
export const publicCors = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  await next();
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Vary', 'Origin');
});

/** Private routes are same-origin only: cookies plus an Origin check on writes. */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    const self = new URL(c.req.url).origin;
    if (origin && origin !== self && origin !== c.env.BETTER_AUTH_URL) throw new ApiError(403, 'forbidden', 'Cross-origin writes to private endpoints are not allowed.');
  }
  await next();
});

/** Who a public request is for: the Markets app itself (same-origin browser requests or a signed-in session) or an outside API client.
 * Browsers set Sec-Fetch-Site and pages can't override it. Providers whose terms allow display but not redistribution are only served to the app. */
export function audienceOf(c: { req: { header(n: string): string | undefined }; get(k: 'userId'): string | null }): 'app' | 'api' {
  if (c.get('userId')) return 'app';
  return c.req.header('sec-fetch-site') === 'same-origin' ? 'app' : 'api';
}

/** Edge cache for public GETs (Cache API). Respects each provider's caching rights via max-age. */
export function edgeCache(maxAge: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    // Visitors and demo guests all see the same shared demo data, so their responses can be cached; only
    // signed-in accounts (which may use their own data keys) skip the cache.
    if (!cache || c.req.method !== 'GET' || (c.get('userId') && !c.get('isAnonymous'))) { await next(); return; }
    // The app and outside API clients can see different data (some providers allow display but not redistribution).
    const key = new Request(`${c.req.url}${c.req.url.includes('?') ? '&' : '?'}__aud=${audienceOf(c)}`, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) { const r = new Response(hit.body, hit); r.headers.set('X-Cache', 'HIT'); return r; }
    await next();
    if (c.res.status === 200) {
      c.res.headers.set('Cache-Control', `public, max-age=${maxAge}`);
      c.executionCtx?.waitUntil?.(cache.put(key, c.res.clone()));
    }
  });
}

/** Collapses identical concurrent upstream calls into one. */
const inflight = new Map<string, Promise<unknown>>();
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = inflight.get(key) as Promise<T> | undefined;
  if (p) return p;
  const run = fn().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
