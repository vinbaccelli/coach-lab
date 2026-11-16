// Seed test accounts into the local stack and print what a browser test needs.
// Usage: node scripts/local-stack/seed.mjs   (prints JSON: anon key, service key, per-user cookie)
import pg from 'pg';
import { signJwt, sessionFor } from './server.mjs';

const DB_URL = process.env.LOCAL_DB_URL || 'postgres://postgres@127.0.0.1:54322/coachlab';
export const USERS = [
  { key: 'coachA', id: '11111111-1111-4111-8111-111111111111', email: 'coach.a@example.test', tier: 'pro' },
  { key: 'coachB', id: '22222222-2222-4222-8222-222222222222', email: 'coach.b@example.test', tier: 'pro' },
  { key: 'coachLight', id: '33333333-3333-4333-8333-333333333333', email: 'coach.light@example.test', tier: 'light' },
  { key: 'coachFree', id: '44444444-4444-4444-8444-444444444444', email: 'coach.free@example.test', tier: null },
];

export async function seed() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  for (const u of USERS) {
    await client.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing', [u.id, u.email]);
    if (u.tier) {
      await client.query(
        `insert into public.subscriptions (user_id, status, tier, billing_interval) values ($1, 'active', $2, 'month')
         on conflict (user_id) do update set status = 'active', tier = excluded.tier`, [u.id, u.tier]);
    }
  }
  await client.end();
}

export function cookieFor(user) {
  const session = sessionFor({ id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {} });
  return { name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url') };
}

export const ANON_KEY = signJwt({ role: 'anon', iss: 'local', iat: 1700000000, exp: 4102444800 });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'local', iat: 1700000000, exp: 4102444800 });

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  await seed();
  console.log(JSON.stringify({ anonKey: ANON_KEY, serviceKey: SERVICE_KEY, users: USERS.map((u) => ({ ...u, cookie: cookieFor(u) })) }, null, 2));
}
