// Personal data keys: encrypted at rest, decrypted only on the server, never sent back to the browser.
import { all, first, run } from './db';

export interface AlpacaCreds { keyId: string; secret: string }
export interface EodhdCreds { token: string }
export interface Keys { alpaca?: AlpacaCreds; eodhd?: EodhdCreds & { dailyLimit: number | null } }
export type Provider = 'alpaca' | 'eodhd';
export interface Connection { provider: Provider; hint: string; status: string; createdAt: string; checkedAt: string | null; meta: Record<string, unknown> | null }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

const aes = new Map<string, Promise<CryptoKey>>();
function aesKey(secret: string) {
  let k = aes.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
      .then(base => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('markets-data-keys'), info: enc.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    aes.set(secret, k);
  }
  return k;
}
export async function seal(secret: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(JSON.stringify(value))));
  return { ciphertext: b64(ct), iv: b64(iv) };
}
export async function open<T>(secret: string, ciphertext: string, iv: string): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(secret), unb64(ciphertext));
  return JSON.parse(dec.decode(pt)) as T;
}

/** A user's working keys, cached briefly per isolate so each request doesn't query and decrypt again. */
const cache = new Map<string, { until: number; keys: Keys }>();
export async function userKeys(db: D1Database, secret: string, userId: string): Promise<Keys> {
  const hit = cache.get(userId); if (hit && hit.until > Date.now()) return hit.keys;
  const rows = await all<{ provider: Provider; ciphertext: string; iv: string; status: string; meta: string | null }>(db, "SELECT provider, ciphertext, iv, status, meta FROM data_connections WHERE user_id = ? AND status = 'ok'", userId);
  const keys: Keys = {};
  for (const r of rows) {
    const creds = await open<any>(secret, r.ciphertext, r.iv).catch(() => null);
    if (!creds) continue;
    if (r.provider === 'alpaca') keys.alpaca = creds;
    if (r.provider === 'eodhd') keys.eodhd = { ...creds, dailyLimit: (r.meta ? JSON.parse(r.meta).dailyLimit : null) ?? null };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(userId, { until: Date.now() + 60_000, keys });
  return keys;
}
export const forgetKeys = (userId: string) => cache.delete(userId);

export async function saveKey(db: D1Database, secret: string, userId: string, provider: Provider, creds: AlpacaCreds | EodhdCreds, hint: string, meta: Record<string, unknown> | null = null) {
  const { ciphertext, iv } = await seal(secret, creds);
  await run(db, `INSERT INTO data_connections (user_id, provider, ciphertext, iv, hint, status, checked_at, meta) VALUES (?, ?, ?, ?, ?, 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, hint = excluded.hint, status = 'ok', checked_at = excluded.checked_at, meta = excluded.meta`, userId, provider, ciphertext, iv, hint, meta ? JSON.stringify(meta) : null);
  forgetKeys(userId);
}
export async function markInvalid(db: D1Database, userId: string, provider: Provider) {
  await run(db, "UPDATE data_connections SET status = 'invalid', checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND provider = ?", userId, provider);
  forgetKeys(userId);
}
export async function removeConnection(db: D1Database, userId: string, provider: string) {
  await run(db, 'DELETE FROM data_connections WHERE user_id = ? AND provider = ?', userId, provider);
  forgetKeys(userId);
}
export async function listConnections(db: D1Database, userId: string): Promise<Connection[]> {
  const rows = await all<{ provider: Provider; hint: string; status: string; created_at: string; checked_at: string | null; meta: string | null }>(db, 'SELECT provider, hint, status, created_at, checked_at, meta FROM data_connections WHERE user_id = ?', userId);
  return rows.map(r => ({ provider: r.provider, hint: r.hint, status: r.status, createdAt: r.created_at, checkedAt: r.checked_at, meta: r.meta ? JSON.parse(r.meta) : null }));
}
export { first };
