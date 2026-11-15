// A D1-shaped wrapper over node:sqlite so API tests run against the real migrations and SQL.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args.map(a => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a))); }
  async all() { return { results: this.db.prepare(this.sql).all(...(this.args as any[])), success: true, meta: {} }; }
  async first(col?: string) { const r = this.db.prepare(this.sql).get(...(this.args as any[])) as any; return r == null ? null : col ? r[col] : r; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as any[])); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  runSync() { const r = this.db.prepare(this.sql).run(...(this.args as any[])); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
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
  return d1 as unknown as D1Database & { raw: DatabaseSync };
}

export function addUser(db: D1Database & { raw: DatabaseSync }, id: string, anonymous = false) {
  const now = new Date().toISOString();
  db.raw.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAnonymous) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, id, `${id}@test.invalid`, now, now, anonymous ? 1 : 0);
}
