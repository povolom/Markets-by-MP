// Structured errors, pagination and small helpers used by every route.
import type { Context } from 'hono';

export type ErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'unavailable' | 'upstream_error' | 'not_permitted' | 'internal';

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown, public retryAfter?: number) { super(message); }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found.`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, 'bad_request', msg, details);

export function errorBody(c: Context, e: ApiError) {
  return { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), requestId: c.get('requestId') ?? null } };
}

export function errorResponse(c: Context, err: unknown) {
  const e = err instanceof ApiError ? err : new ApiError(500, 'internal', 'Something went wrong on our side.');
  if (!(err instanceof ApiError)) console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), path: new URL(c.req.url).pathname, error: String((err as Error)?.message ?? err) }));
  const res = c.json(errorBody(c, e), e.status as 400);
  if (e.retryAfter) res.headers.set('Retry-After', String(e.retryAfter));
  return res;
}

/** Cursor pagination over an in-memory list: cursor is the offset, opaque to clients. */
export function paginate<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Math.max(0, parseInt(atob(cursor), 10) || 0) : 0;
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? btoa(String(start + limit)) : null;
  return { data: page, pagination: { limit, nextCursor: next, total: items.length } };
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const nowIso = () => new Date().toISOString();
