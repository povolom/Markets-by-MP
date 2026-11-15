// Thin, typed access to D1. Every private query takes the user ID and filters on it.
export type Row = Record<string, unknown>;

export async function all<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  return ((await db.prepare(sql).bind(...binds).all()).results ?? []) as T[];
}
export async function first<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...binds).first()) as T | null;
}
export async function run(db: D1Database, sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}
export const stmt = (db: D1Database, sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds);
export const json = <T>(v: unknown, fallback: T): T => { try { return typeof v === 'string' ? JSON.parse(v) : fallback; } catch { return fallback; } };
