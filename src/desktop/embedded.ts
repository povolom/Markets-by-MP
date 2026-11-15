// The Markets API running inside the desktop app's own window: the same Hono routes as the hosted API,
// a local SQLite database (WebAssembly) saved in the app's data folder, prices fetched through the app's
// native HTTP (only the data sources allowed in src-tauri/capabilities), and dip alerts as notifications.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { BaseDirectory, exists, mkdir, readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createApi } from '../server/app';
import { evaluateAll } from '../server/jobs/alerts';
import { setFetcher } from '../server/providers/fetch-cache';
import { MIGRATIONS } from './migrations';
import { migrateSqlJs, sqlJsD1 } from './sqljs-d1';

const OWNER = 'owner';
const DB_FILE = 'markets.db', SECRET_FILE = 'secret.txt';
const opts = { baseDir: BaseDirectory.AppData };

export type Handler = (req: Request) => Promise<Response>;

async function localSecret() {
  if (await exists(SECRET_FILE, opts)) return (await readTextFile(SECRET_FILE, opts)).trim();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes));
  await writeTextFile(SECRET_FILE, secret, opts);
  return secret;
}

export async function start(): Promise<Handler> {
  if (!(await exists('', opts))) await mkdir('', { ...opts, recursive: true });
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database((await exists(DB_FILE, opts)) ? await readFile(DB_FILE, opts) : undefined);
  migrateSqlJs(db, MIGRATIONS);
  const now = new Date().toISOString();
  db.run('INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAnonymous) VALUES (?, ?, ?, 1, ?, ?, 0)', [OWNER, 'You', 'owner@this-device.local', now, now]);

  // Save to disk shortly after any change (writes are small and infrequent).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => { const data = db.export(); db.run('PRAGMA foreign_keys = ON;'); void writeFile(DB_FILE, data, opts); };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; save(); }, 400); };
  window.addEventListener('beforeunload', () => { if (timer) { clearTimeout(timer); save(); } });

  // Prices come through the app's native HTTP, which isn't limited by the browser's cross-site rules.
  setFetcher((url, init) => nativeFetch(url, init));

  const d1 = sqlJsD1(db, schedule);
  const env = { DB: d1, BETTER_AUTH_SECRET: await localSecret(), BETTER_AUTH_URL: 'http://markets.local', ENVIRONMENT: 'desktop', MARKET_DATA: 'personal', DESKTOP_PLATFORM: /Mac/i.test(navigator.userAgent) ? 'darwin' : 'win32' } as any;
  const { app, marketFor } = createApi(async () => ({ userId: OWNER, isAnonymous: false }));

  // Links to other sites open in your normal browser. Links inside Markets always stay in this window
  // (even with Cmd or Ctrl held), because the app can't load a page from a deep path directly.
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) { e.preventDefault(); void openUrl(href); return; }
    if (href.startsWith('/')) {
      e.preventDefault();
      if (location.pathname + location.search !== href) { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0 }); }
    }
  }, true);

  // Dip rules are checked every 30 minutes while the app is open; matches arrive as notifications.
  let lastSeen = new Date().toISOString();
  const check = async () => {
    try {
      await evaluateAll(d1, uid => marketFor(env, uid, { scheduled: true }));
      const rows = (db.exec('SELECT message, created_at FROM alert_events WHERE user_id = ? AND created_at > ? ORDER BY created_at', [OWNER, lastSeen])[0]?.values ?? []) as [string, string][];
      if (!rows.length) return;
      lastSeen = rows[rows.length - 1][1];
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) for (const [message] of rows) sendNotification({ title: 'Markets: your rule matched', body: message });
    } catch (e) { console.error('alert check failed', e); }
  };
  setTimeout(check, 60_000);
  setInterval(check, 30 * 60_000);

  return async req => app.fetch(req, env);
}
