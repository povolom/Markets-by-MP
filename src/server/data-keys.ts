// Personal data keys: encrypted at rest, decrypted only on the server, never sent back to the browser.
import { all, first, run } from './db';

export interface AlpacaCreds { keyId: string; secret: string }
export interface Connection { provider: 'alpaca'; hint: string; status: string; createdAt: string; checkedAt: string | null }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();
function aesKey(secret: string) {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
      .then(base => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('markets-data-keys'), info: enc.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    keys.set(secret, k);
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

/** Decrypted credentials for one user, cached briefly per isolate so each request doesn't decrypt again. */
const cache = new Map<string, { until: number; creds: AlpacaCreds | null }>();
export async function alpacaCreds(db: D1Database, secret: string, userId: string): Promise<AlpacaCreds | null> {
  const hit = cache.get(userId); if (hit && hit.until > Date.now()) return hit.creds;
  const row = await first<{ ciphertext: string; iv: string; status: string }>(db, "SELECT ciphertext, iv, status FROM data_connections WHERE user_id = ? AND provider = 'alpaca'", userId);
  const creds = row && row.status === 'ok' ? await open<AlpacaCreds>(secret, row.ciphertext, row.iv).catch(() => null) : null;
  if (cache.size > 2000) cache.clear();
  cache.set(userId, { until: Date.now() + 60_000, creds });
  return creds;
}
export const forgetCreds = (userId: string) => cache.delete(userId);

export async function saveAlpaca(db: D1Database, secret: string, userId: string, creds: AlpacaCreds) {
  const { ciphertext, iv } = await seal(secret, creds);
  await run(db, `INSERT INTO data_connections (user_id, provider, ciphertext, iv, hint, status, checked_at) VALUES (?, 'alpaca', ?, ?, ?, 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, hint = excluded.hint, status = 'ok', checked_at = excluded.checked_at`, userId, ciphertext, iv, creds.keyId.slice(-4));
  forgetCreds(userId);
}
export async function markInvalid(db: D1Database, userId: string) {
  await run(db, "UPDATE data_connections SET status = 'invalid', checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND provider = 'alpaca'", userId);
  forgetCreds(userId);
}
export async function removeConnection(db: D1Database, userId: string, provider: string) {
  await run(db, 'DELETE FROM data_connections WHERE user_id = ? AND provider = ?', userId, provider);
  forgetCreds(userId);
}
export async function listConnections(db: D1Database, userId: string): Promise<Connection[]> {
  const rows = await all<{ provider: 'alpaca'; hint: string; status: string; created_at: string; checked_at: string | null }>(db, 'SELECT provider, hint, status, created_at, checked_at FROM data_connections WHERE user_id = ?', userId);
  return rows.map(r => ({ provider: r.provider, hint: r.hint, status: r.status, createdAt: r.created_at, checkedAt: r.checked_at }));
}
