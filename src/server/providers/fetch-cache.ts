// Cached JSON fetches for upstream providers. Two layers: this isolate's memory, then the edge
// Cache API (shared by every isolate in a Cloudflare location). Each provider passes its own TTL,
// which never exceeds what its terms allow.

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
/** Tests swap the network for fixtures. */
export function setFetcher(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init)); memory.clear(); }

const memory = new Map<string, { until: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export class UpstreamError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function cachedJson<T>(url: string, ttlSec: number, headers: Record<string, string> = {}): Promise<T> {
  const now = Date.now();
  const m = memory.get(url);
  if (m && m.until > now) return m.value as T;
  const running = inflight.get(url);
  if (running) return running as Promise<T>;
  const job = (async () => {
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const key = new Request(url);
    let res = cache ? await cache.match(key).catch(() => undefined) : undefined;
    if (!res) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      try { res = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': 'markets-by-mp/1.0', ...headers }, signal: ctl.signal }); }
      catch { throw new UpstreamError(504, 'The data provider did not answer in time.'); }
      finally { clearTimeout(t); }
      if (!res.ok) throw new UpstreamError(res.status, res.status === 429 ? 'The data provider is rate limiting Markets right now.' : `The data provider returned ${res.status}.`);
      if (cache) {
        const copy = new Response(res.clone().body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSec}` } });
        await cache.put(key, copy).catch(() => null);
      }
    }
    const value = await res.json() as T;
    if (memory.size > 300) memory.clear();
    memory.set(url, { until: now + ttlSec * 1000, value });
    return value;
  })().finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}
