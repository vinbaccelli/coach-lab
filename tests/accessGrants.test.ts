import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canDownloadEbook, canUse, FEATURES, type Feature } from '@/lib/entitlements';
import { getEntitlement, requireFeature } from '@/lib/entitlements.server';

const ALL = Object.keys(FEATURES) as Feature[];
const sub = (tier: string, status = 'active', extra: Record<string, unknown> = {}) =>
  ({ tier, status, current_period_end: '2027-01-01T00:00:00.000Z', cancel_at_period_end: false, ...extra });

/**
 * Supabase stand-in: own subscription row, trial row, and the RPCs.
 * `grant` is what my_access_grant() returns for the caller: 'pro' for an
 * active grant, null for none or a revoked one (the SQL filters revoked rows).
 */
function db(opts: {
  own?: Record<string, unknown> | null;
  grant?: string | null;
  grantError?: string;
  seats?: unknown[];
  trialStartedAt?: string | null;
}) {
  const calls: string[] = [];
  const from = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      async maybeSingle() {
        if (table === 'subscriptions') return { data: opts.own ?? null, error: null };
        if (table === 'trials') return { data: opts.trialStartedAt ? { started_at: opts.trialStartedAt } : null, error: null };
        return { data: null, error: null };
      },
    };
    return q;
  };
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === 'my_access_grant') {
      return opts.grantError ? { data: null, error: { message: opts.grantError } } : { data: opts.grant ?? null, error: null };
    }
    if (name === 'academy_seat_subscriptions') return { data: opts.seats ?? [], error: null };
    if (name === 'start_trial') return { data: new Date().toISOString(), error: null };
    return { data: null, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, calls };
}

const user = { id: 'granted-1', email: 'Granted@Example.com' };
const quiet = async <T>(fn: () => Promise<T>) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('a grant gives Pro tools from the first sign-in: no subscription, no trial timer, no paywall', async () => {
  const { client, calls } = db({ grant: 'pro' });
  const e = await getEntitlement(client, user, { startTrial: true });
  assert.equal(e.plan, 'pro');
  assert.equal(e.trial, false);
  assert.equal(e.interval, null);
  assert.equal(e.academyMember, false);
  assert.deepEqual(calls, ['my_access_grant'], 'decided before the seat lookup and before the free hour starts');
  for (const f of ALL) assert.equal(canUse(f, e), true, f);
  assert.equal(canDownloadEbook(e), false, 'the ebook stays with yearly subscribers');
  assert.equal(await requireFeature(db({ grant: 'pro' }).client, user, 'motionLayer'), null);
});

test('a lookup error (SQL not run yet) gives no grant, never access, and logs a warning', async () => {
  const warned: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
  try {
    const { client } = db({ grantError: 'function public.my_access_grant() does not exist' });
    const e = await getEntitlement(client, user, { startTrial: false });
    assert.equal(e.plan, null);
    assert.equal(e.trial, false);
    assert.match(String(warned[0]), /access grant lookup failed, treating as no grant/);
    const denied = await requireFeature(db({ grantError: 'boom' }).client, user, 'players');
    assert.equal(denied?.status, 403);
  } finally {
    console.warn = warn;
  }
});

test('a revoked grant (or none) gives nothing: the coach falls back to their own state', async () => {
  const none = db({ grant: null });
  const e = await getEntitlement(none.client, user, { startTrial: true });
  assert.equal(e.plan, null);
  assert.equal(e.trial, true, 'falls through to the ordinary free hour');
  assert.deepEqual(none.calls, ['my_access_grant', 'academy_seat_subscriptions', 'start_trial']);
  // Only the exact string 'pro' grants.
  for (const odd of ['academy', 'PRO', '', true, 1]) {
    const r = await quiet(() => getEntitlement(db({ grant: odd as never }).client, user, { startTrial: false }));
    assert.equal(r.plan, null, String(odd));
  }
});

test('own Pro or Academy still wins: a grant never downgrades or replaces a subscription', async () => {
  for (const [tier, interval] of [['academy', 'year'], ['academy', 'month'], ['pro', 'year']] as const) {
    const { client, calls } = db({ own: { ...sub(tier), billing_interval: interval }, grant: 'pro' });
    const e = await getEntitlement(client, user, { startTrial: true });
    assert.equal(e.plan, tier);
    assert.equal(e.interval, interval);
    assert.deepEqual(calls, [], 'the grant is not even read');
  }
  // A yearly Academy owner keeps their ebook; a grant would not.
  const academy = await getEntitlement(db({ own: { ...sub('academy'), billing_interval: 'year' }, grant: 'pro' }).client, user, { startTrial: false });
  assert.equal(canDownloadEbook(academy), true);
});

test('a Light subscriber with a grant gets Pro tools; a grant outranks a seat lookup', async () => {
  const { client, calls } = db({ own: { ...sub('light'), billing_interval: 'month' }, grant: 'pro', seats: [sub('academy')] });
  const e = await getEntitlement(client, user, { startTrial: false });
  assert.equal(e.plan, 'pro');
  assert.deepEqual(calls, ['my_access_grant']);
});

test('the migration: email-keyed, Pro only, RLS with no policies, caller-only function, idempotent seed', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261015120000_access_grants.sql'), 'utf8');
  assert.match(sql, /email text primary key check \(email = lower\(email\)\)/);
  assert.match(sql, /tier text not null default 'pro' check \(tier = 'pro'\)/);
  assert.match(sql, /alter table public\.access_grants enable row level security;/);
  assert.doesNotMatch(sql, /create policy/i, 'no policies: service role and the function only');
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/);
  assert.match(sql, /where g\.email = lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)\s+and g\.revoked_at is null/);
  assert.match(sql, /grant execute on function public\.my_access_grant\(\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.my_access_grant\(\) from anon;/);
  assert.match(sql, /'kneepkensalexander@gmail\.com', 'complimentary Pro, launch'/);
  assert.match(sql, /'tennisbydani@gmail\.com', 'complimentary Pro, launch'/);
  assert.match(sql, /on conflict \(email\) do nothing;/);
  const statements = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(statements, /subscriptions|fiscal_invoices|stripe/i, 'a grant never touches billing tables');
});
