/**
 * Database tests against the local stack's Postgres (scripts/local-stack/start.sh). They run SQL as
 * the same roles Supabase uses, with the same JWT claims, so they exercise the real RLS policies.
 * Not part of `npm test` (no database there): run with `npm run test:db`.
 */
import pg from 'pg';

export const DB_URL = process.env.LOCAL_DB_URL || 'postgres://postgres@127.0.0.1:54322/coachlab';
export const COACH_A = '11111111-1111-4111-8111-111111111111';
export const COACH_B = '22222222-2222-4222-8222-222222222222';

export async function connect() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

/** Run `fn` in a transaction as `role` with JWT claims for `sub`; always rolled back. */
export async function as<T>(c: pg.Client, role: 'anon' | 'authenticated' | 'service_role', sub: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    return await fn((sql, params) => c.query(sql, params as unknown[]));
  } finally {
    await c.query('rollback');
  }
}

/** Like `as`, but returns the Postgres error code (or null when the statement succeeded). */
export async function errorCode(c: pg.Client, role: 'anon' | 'authenticated' | 'service_role', sub: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await as(c, role, sub, (q) => q(sql, params));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}

/** A player owned by `coach`, created as the superuser (committed; tests clean up by coach). */
export async function makePlayer(c: pg.Client, coach: string, name: string): Promise<string> {
  const r = await c.query('insert into public.players (coach_id, display_name) values ($1, $2) returning id', [coach, name]);
  return r.rows[0].id as string;
}
