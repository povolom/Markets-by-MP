// A D1-shaped wrapper over node:sqlite. The desktop app stores everything in a local SQLite file through
// it, and the API tests run against the real migrations with it.
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args.map(a => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a))); }
  async all() { return { results: this.db.prepare(this.sql).all(...(this.args as any[])), success: true, meta: {} }; }
  async first(col?: string) { const r = this.db.prepare(this.sql).get(...(this.args as any[])) as any; return r == null ? null : col ? r[col] : r; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as any[])); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  runSync() { const r = this.db.prepare(this.sql).run(...(this.args as any[])); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export type LocalD1 = D1Database & { raw: DatabaseSync };

export function openSqliteD1(path: string): LocalD1 {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try { const out = stmts.map(s => s.runSync()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 }; },
    raw: db,
  };
  return d1 as unknown as LocalD1;
}

/** Applies migrations that haven't run yet, in order, each in a transaction. */
export function migrate(d1: LocalD1, migrations: { name: string; sql: string }[]) {
  const db = d1.raw;
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(r => r.name));
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    db.exec('BEGIN');
    try { db.exec(m.sql); db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(m.name, new Date().toISOString()); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
