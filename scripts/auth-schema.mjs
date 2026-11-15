// Prints the SQL Better Auth needs (core tables + anonymous plugin) using its own migration tool
// against an in-memory SQLite database. Used once to write migrations/0001_auth.sql.
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
const auth = betterAuth({ database: new DatabaseSync(':memory:'), secret: 'x'.repeat(40), baseURL: 'http://localhost', emailAndPassword: { enabled: true }, plugins: [anonymous()] });
const m = await getMigrations(auth.options);
console.log(Object.keys(m).join(','));
if (m.compileMigrations) console.log(await m.compileMigrations());
