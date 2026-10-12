import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canUse, canDownloadEbook, FEATURES, NO_ENTITLEMENT, type Entitlement, type Feature } from '@/lib/entitlements';
import { requireFeature } from '@/lib/entitlements.server';

const ALL = Object.keys(FEATURES) as Feature[];
const LIGHT = ALL.filter((f) => FEATURES[f].plan === 'light');
const PRO = ALL.filter((f) => FEATURES[f].plan === 'pro');

const who = {
  none: { ...NO_ENTITLEMENT },
  trial: { ...NO_ENTITLEMENT, trial: true },
  admin: { ...NO_ENTITLEMENT, admin: true },
  light: { ...NO_ENTITLEMENT, plan: 'light', interval: 'year' },
  proMonthly: { ...NO_ENTITLEMENT, plan: 'pro', interval: 'month' },
  proYearly: { ...NO_ENTITLEMENT, plan: 'pro', interval: 'year' },
  academyYearly: { ...NO_ENTITLEMENT, plan: 'academy', interval: 'year' },
  academyMember: { ...NO_ENTITLEMENT, plan: 'pro', academyMember: true },
} satisfies Record<string, Entitlement>;

test('feature table matches the launch decision (Light vs Pro lists)', () => {
  assert.deepEqual(LIGHT.sort(), [
    'academy', 'aiDetect', 'angleDifferential', 'dataColumn', 'draw', 'jointChain', 'ruler', 'screenshot', 'skeleton', 'snapshot',
  ]);
  assert.deepEqual(PRO.sort(), [
    'aiTrack', 'coachProfile', 'docsExport', 'generate', 'matchAnalyzer', 'matchDecoder', 'motionLayer', 'multiSnapshot',
    'players', 'recordingHub', 'saveToPlayer', 'youtube',
  ]);
});

test('canUse: no subscription gets nothing', () => {
  for (const f of ALL) assert.equal(canUse(f, who.none), false, f);
});

test('canUse: trial and admin bypass every gate', () => {
  for (const f of ALL) {
    assert.equal(canUse(f, who.trial), true, `trial ${f}`);
    assert.equal(canUse(f, who.admin), true, `admin ${f}`);
  }
});

test('canUse: Light gets the Light list only', () => {
  for (const f of LIGHT) assert.equal(canUse(f, who.light), true, f);
  for (const f of PRO) assert.equal(canUse(f, who.light), false, f);
});

test('canUse: Pro, Academy and an Academy member get everything', () => {
  for (const f of ALL) {
    assert.equal(canUse(f, who.proMonthly), true, `pro ${f}`);
    assert.equal(canUse(f, who.academyYearly), true, `academy ${f}`);
    assert.equal(canUse(f, who.academyMember), true, `member ${f}`);
  }
});

test('canDownloadEbook: yearly Pro/Academy subscribers and admins only', () => {
  assert.equal(canDownloadEbook(who.proYearly), true);
  assert.equal(canDownloadEbook(who.academyYearly), true);
  assert.equal(canDownloadEbook(who.admin), true);
  assert.equal(canDownloadEbook(who.proMonthly), false);
  assert.equal(canDownloadEbook({ ...who.academyYearly, interval: 'month' }), false);
  assert.equal(canDownloadEbook(who.light), false);
  assert.equal(canDownloadEbook(who.academyMember), false);
  assert.equal(canDownloadEbook({ ...who.academyMember, interval: 'year' }), false);
  assert.equal(canDownloadEbook(who.trial), false);
  assert.equal(canDownloadEbook(who.none), false);
});

/** Minimal chainable Supabase stand-in for the reads getEntitlement makes. */
function mockSupabase(opts: {
  sub?: Record<string, unknown> | null;
  subError?: string;
  trialStartedAt?: string | null;
  members?: Array<Record<string, unknown>>;
  ownerSubs?: Record<string, Record<string, unknown>>;
}): SupabaseClient {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => { filters[col] = v; return q; },
      ilike: (col: string, v: unknown) => { filters[col] = v; return q; },
      limit: () => q,
      in: (col: string, v: unknown) => { filters[col] = v; return q; },
      async maybeSingle() {
        if (table === 'subscriptions') {
          if (opts.subError) return { data: null, error: { message: opts.subError } };
          if (filters.user_id && opts.ownerSubs?.[filters.user_id as string]) return { data: opts.ownerSubs[filters.user_id as string], error: null };
          return { data: opts.sub ?? null, error: null };
        }
        if (table === 'trials') return { data: opts.trialStartedAt ? { started_at: opts.trialStartedAt } : null, error: null };
        return { data: null, error: null };
      },
      then(resolve: (v: unknown) => void) {
        if (table === 'academy_members') resolve({ data: opts.members ?? [], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
}

const user = { id: 'u1', email: 'coach@example.com' };
const active = (tier: string, interval = 'month') => ({ status: 'active', tier, billing_interval: interval, current_period_end: null, cancel_at_period_end: false });

test('requireFeature: 403 plan_required for a Light coach on a Pro API', async () => {
  const res = await requireFeature(mockSupabase({ sub: active('light') }), user, 'players');
  assert.ok(res);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'plan_required');
  assert.equal(body.feature, 'players');
  assert.equal(body.required, 'pro');
  assert.match(body.message, /Player database is part of the Pro plan/);
});

test('requireFeature: allowed (null) for Pro, Academy, trial and admin', async () => {
  assert.equal(await requireFeature(mockSupabase({ sub: active('pro') }), user, 'docsExport'), null);
  assert.equal(await requireFeature(mockSupabase({ sub: active('academy', 'year') }), user, 'youtube'), null);
  const inTrial = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(await requireFeature(mockSupabase({ trialStartedAt: inTrial }), user, 'players'), null);
  assert.equal(await requireFeature(mockSupabase({}), { id: 'a', email: 'vinbaccelli@gmail.com' }, 'players'), null);
});

test('requireFeature: no subscription and an expired trial are refused', async () => {
  const none = await requireFeature(mockSupabase({}), user, 'academy');
  assert.equal(none?.status, 403);
  const expired = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const old = await requireFeature(mockSupabase({ trialStartedAt: expired }), user, 'coachProfile');
  assert.equal(old?.status, 403);
});

test('requireFeature: a lapsed subscription (canceled / unpaid) is refused', async () => {
  for (const status of ['canceled', 'unpaid', 'incomplete']) {
    const res = await requireFeature(mockSupabase({ sub: { ...active('pro'), status } }), user, 'players');
    assert.equal(res?.status, 403, status);
  }
});

test('requireFeature: past_due keeps access (payment-failed grace)', async () => {
  assert.equal(await requireFeature(mockSupabase({ sub: { ...active('pro'), status: 'past_due' } }), user, 'players'), null);
});

test('requireFeature: a database error fails open', async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    assert.equal(await requireFeature(mockSupabase({ subError: 'boom' }), user, 'players'), null);
  } finally {
    console.error = orig;
  }
});
