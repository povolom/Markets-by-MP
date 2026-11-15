// A D1-shaped wrapper over sql.js (SQLite compiled to WebAssembly), for the desktop app, where the
// Markets API runs inside the app's own window. The database lives in memory and is saved to a file
// in the app's data folder after every change (see embedded.ts).
import type { Database } from 'sql.js';

type Param = string | number | null | Uint8Array;
const norm = (a: unknown): Param => (a === undefined || a === null ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a as Param);

class Stmt {
  constructor(private db: Database, private sql: string, private args: Param[] = [], private onWrite: () => void) {}
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args.map(norm), this.onWrite); }
  private rows() {
    const st = this.db.prepare(this.sql);
    try { st.bind(this.args); const out: Record<string, unknown>[] = []; while (st.step()) out.push(st.getAsObject()); return out; }
    finally { st.free(); }
  }
  async all() { return { results: this.rows(), success: true, meta: {} }; }
  async first(col?: string) { const r = this.rows()[0] as any; return r == null ? null : col ? r[col] : r; }
  runSync() {
    this.db.run(this.sql, this.args);
    const changes = this.db.getRowsModified();
    const last = (this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] as number) ?? 0;
    this.onWrite();
    return { success: true, meta: { changes, last_row_id: last } };
  }
  async run() { return this.runSync(); }
}

export function sqlJsD1(db: Database, onWrite: () => void): D1Database {
  db.run('PRAGMA foreign_keys = ON;');
  return {
    prepare: (sql: string) => new Stmt(db, sql, [], onWrite),
    async batch(stmts: Stmt[]) {
      db.run('BEGIN');
      try { const out = stmts.map(s => s.runSync()); db.run('COMMIT'); return out; }
      catch (e) { db.run('ROLLBACK'); throw e; }
    },
    async exec(sql: string) { db.exec(sql); onWrite(); return { count: 1, duration: 0 }; },
  } as unknown as D1Database;
}

export function migrateSqlJs(db: Database, migrations: { name: string; sql: string }[]) {
  db.run('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.exec('SELECT name FROM _migrations')[0]?.values ?? []).map(v => String(v[0])));
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    db.run('BEGIN');
    try { db.exec(m.sql); db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [m.name, new Date().toISOString()]); db.run('COMMIT'); }
    catch (e) { db.run('ROLLBACK'); throw e; }
  }
}
