// The web app talks to the same Markets API as any other client.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

// The desktop app has no accounts; its window address (tauri://) isn't http, so the auth client gets a placeholder.
const webOrigin = typeof location !== 'undefined' && location.protocol.startsWith('http');
export const authClient = createAuthClient({ ...(webOrigin ? {} : { baseURL: 'http://markets.local' }), basePath: '/api/auth', plugins: [anonymousClient()] });

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

/** In the desktop app the Markets API runs inside the window (src/desktop/main.tsx sets this up); requests
 * go straight to it instead of over the network. */
type Embedded = (req: Request) => Promise<Response>;
const embedded = (): Promise<Embedded> | undefined => (globalThis as { __MARKETS_EMBEDDED__?: Promise<Embedded> }).__MARKETS_EMBEDDED__;
export const isDesktopApp = () => Boolean(embedded());

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined };
  const local = embedded();
  const res = local ? await (await local)(new Request(`http://markets.local/api/v1${path}`, init)) : await fetch(`/api/v1${path}`, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.details);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = any>(p: string, b?: unknown) => request<T>('DELETE', p, b),
};

/** 'desktop' when this is the Markets app running on your own computer (no accounts, personal data sources). */
let modeCache: Promise<'desktop' | 'web'> | null = null;
export const appMode = () => (modeCache ??= request<{ mode?: string; platform?: string | null }>('GET', '/status').then(s => {
  if (s.mode === 'desktop') document.documentElement.dataset.desktop = s.platform === 'darwin' ? 'mac' : 'win';
  return (s.mode === 'desktop' ? 'desktop' : 'web') as 'desktop' | 'web';
}).catch(() => 'web' as const));
export function useMode() {
  const [mode, setMode] = useState<'desktop' | 'web' | null>(null);
  useEffect(() => { void appMode().then(setMode); }, []);
  return mode;
}

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
