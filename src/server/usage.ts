// Counts Markets API calls for the public stats on the website. Counts are kept in memory per isolate and
// written to D1 in small batches (one upsert per day and kind), so counting doesn't cost a write per request.
import { all } from './db';
import { cachedJson } from './providers/fetch-cache';

const pending = new Map<string, number>();
let lastFlush = Date.now();

export function countCall(kind: 'app' | 'api') {
  const k = `${new Date().toISOString().slice(0, 10)}|${kind}`;
  pending.set(k, (pending.get(k) ?? 0) + 1);
}

/** Writes pending counts if there are enough of them or a minute has passed. */
export async function flushCounts(db: D1Database, force = false) {
  const total = [...pending.values()].reduce((a, b) => a + b, 0);
  if (!total || (!force && total < 20 && Date.now() - lastFlush < 60_000)) return;
  const rows = [...pending]; pending.clear(); lastFlush = Date.now();
  await db.batch(rows.map(([k, n]) => { const [day, kind] = k.split('|'); return db.prepare('INSERT INTO usage_daily (day, kind, count) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET count = count + excluded.count').bind(day, kind, n); }));
}

export async function apiCallStats(db: D1Database) {
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const rows = await all<{ day: string; kind: string; count: number }>(db, 'SELECT day, kind, count FROM usage_daily');
  const sum = (f: (r: { day: string; kind: string }) => boolean) => rows.filter(f).reduce((a, r) => a + r.count, 0) + [...pending].filter(([k]) => { const [day, kind] = k.split('|'); return f({ day, kind }); }).reduce((a, [, n]) => a + n, 0);
  return {
    total: sum(() => true), last30Days: sum(r => r.day >= since), today: sum(r => r.day === today),
    byKind: { app: sum(r => r.kind === 'app'), api: sum(r => r.kind === 'api') },
    since: rows.map(r => r.day).sort()[0] ?? today,
  };
}

interface Release { tag_name: string; published_at: string; assets: { name: string; download_count: number }[] }
/** Desktop app downloads from the repo's GitHub Releases (public data, cached for an hour). */
export async function downloadStats(repo: string) {
  const releases = await cachedJson<Release[]>(`https://api.github.com/repos/${repo}/releases?per_page=100`, 3600, { accept: 'application/vnd.github+json' });
  const platform = (n: string) => /\.(dmg|app\.tar\.gz)$/i.test(n) || /darwin|mac|aarch64\.dmg|x64\.dmg/i.test(n) ? 'mac' : /\.(exe|msi)$/i.test(n) ? 'windows' : null;
  let mac = 0, windows = 0;
  for (const r of releases) for (const a of r.assets) { const p = platform(a.name); if (p === 'mac') mac += a.download_count; if (p === 'windows') windows += a.download_count; }
  return { total: mac + windows, mac, windows, releases: releases.length, latest: releases[0] ? { version: releases[0].tag_name, publishedAt: releases[0].published_at } : null };
}
