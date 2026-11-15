// Tests use the same SQLite adapter as the desktop app, against the real migrations.
import { readFileSync, readdirSync } from 'node:fs';
import { migrate, openSqliteD1, type LocalD1 } from './sqlite-d1';

export function createTestDb() {
  const db = openSqliteD1(':memory:');
  migrate(db, readdirSync('migrations').sort().map(f => ({ name: f, sql: readFileSync(`migrations/${f}`, 'utf8') })));
  return db;
}

export function addUser(db: LocalD1, id: string, anonymous = false) {
  const now = new Date().toISOString();
  db.raw.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAnonymous) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, id, `${id}@test.invalid`, now, now, anonymous ? 1 : 0);
}
