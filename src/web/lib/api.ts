// The web app talks to the same Markets API as any other client.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [anonymousClient()] });

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.details);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T = any>(p: string, b?: unknown) => request<T>('DELETE', p, b),
};

/** GET with loading, error, stale-while-reloading and manual reload. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [state, set] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: Boolean(path) });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    set(s => ({ ...s, loading: true, error: null }));
    try { const d = await api.get<T>(path); if (n === seq.current) set({ data: d, error: null, loading: false }); }
    catch (e) { if (n === seq.current) set(s => ({ data: s.data, error: e as ApiError, loading: false })); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}
