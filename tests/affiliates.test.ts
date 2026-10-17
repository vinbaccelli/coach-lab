import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commissionForInvoice, invoiceBaseCents, normalizeAffiliateCode, normalizePct, summarizeAffiliate, type Affiliate,
} from '@/lib/affiliates';
import { attributeReferral, influencerView, recordAffiliateCommission, referralRedirect, trackReferralClick } from '@/lib/affiliates.server';

const root = process.cwd();
const src = (f: string) => readFileSync(join(root, f), 'utf8');
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = w; }
};

// ── In-memory Supabase stand-in (the subset lib/affiliates.server.ts uses) ──
type Row = Record<string, unknown>;
const UNIQUE: Record<string, string> = { affiliate_referrals: 'user_id', affiliate_commissions: 'stripe_invoice_id' };
function fakeDb(seed: Record<string, Row[]> = {}, opts: { failOn?: string } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const calls: string[] = [];
  let n = 0;
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'insert' | 'upsert' | 'update' = 'select';
    let payload: Row | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let head = false;
    let returnRows = false;
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const run = () => {
      calls.push(`${op}:${table}`);
      if (opts.failOn === table) return { data: null, error: { message: `${table} is down`, code: 'XX000' }, count: null };
      const rows = tables[table];
      if (op === 'select') {
        const hit = rows.filter(match);
        return { data: head ? null : hit, error: null, count: hit.length };
      }
      if (op === 'insert') {
        const row = { id: `row-${++n}`, created_at: new Date(Date.UTC(2026, 9, 16, 12, n)).toISOString(), ...payload };
        rows.push(row);
        return { data: returnRows ? [row] : null, error: null };
      }
      if (op === 'upsert') {
        const key = upsertOpts.onConflict ?? UNIQUE[table];
        const existing = rows.find((r) => r[key] === payload![key]);
        if (existing) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(existing, payload);
          return { data: upsertOpts.ignoreDuplicates ? [] : [existing], error: null };
        }
        const row = { id: `row-${++n}`, status: table === 'affiliate_commissions' ? 'pending' : undefined, created_at: new Date().toISOString(), ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, payload);
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select(_cols?: string, o?: { head?: boolean }) { if (op !== 'select') returnRows = true; head = !!o?.head; return q; },
      insert(p: Row) { op = 'insert'; payload = p; return q; },
      upsert(p: Row, o: typeof upsertOpts) { op = 'upsert'; payload = p; upsertOpts = o ?? {}; return q; },
      update(p: Row) { op = 'update'; payload = p; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      order() { return q; },
      async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, tables, calls };
}
/** A client whose every call throws, as a broken network or config would. */
const explodingDb = { from() { throw new Error('boom'); } } as unknown as SupabaseClient;

const aff = (over: Partial<Affiliate> = {}): Affiliate => ({
  id: 'aff-1', name: 'Dani', code: 'dani', view_token: 'v'.repeat(43), commission_pct: 20, recurring: false, active: true, ...over,
});
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1', billing_reason: 'subscription_create', amount_paid: 29900, total_excluding_tax: 29900, total_taxes: [], currency: 'eur',
  parent: { subscription_details: { metadata: { userId: 'user-1' }, subscription: 'sub_1' } }, ...over,
});

// ── Rules ──────────────────────────────────────────────────────────────────

test('commission rule: first payment only by default, every payment when recurring', () => {
  const first = commissionForInvoice(aff(), 'user-1', invoice());
  assert.equal(first?.commission_cents, 5980);
  for (const reason of ['subscription_cycle', 'subscription_update', 'manual', null]) {
    assert.equal(commissionForInvoice(aff(), 'user-1', invoice({ billing_reason: reason })), null, `${reason} without recurring`);
    assert.equal(commissionForInvoice(aff({ recurring: true }), 'user-1', invoice({ billing_reason: reason }))?.commission_cents, 5980, `${reason} with recurring`);
  }
  assert.equal(commissionForInvoice(aff({ active: false }), 'user-1', invoice()), null, 'inactive earns nothing');
});

test('pct snapshot: the row keeps the % at the time; a later change does not rewrite it', () => {
  const a = aff({ commission_pct: 12.5 });
  const row = commissionForInvoice(a, 'user-1', invoice({ total_excluding_tax: 14950, amount_paid: 14950 }))!;
  assert.equal(row.pct, 12.5);
  assert.equal(row.commission_cents, 1869); // 14950 × 12.5 % = 1868.75 → rounded
  a.commission_pct = 50;
  assert.equal(row.pct, 12.5);
  assert.equal(row.commission_cents, 1869);
});

test('base: after discounts, without tax, never above what was paid', () => {
  assert.equal(invoiceBaseCents({ amount_paid: 14950, total_excluding_tax: 14950 }), 14950, 'Coach Life 50% code');
  assert.equal(invoiceBaseCents({ amount_paid: 12200, total_excluding_tax: 10000 }), 10000, 'tax excluded');
  assert.equal(invoiceBaseCents({ amount_paid: 5000, total_excluding_tax: 29900 }), 5000, 'account credit: capped at amount paid');
  assert.equal(invoiceBaseCents({ amount_paid: 12200, total_excluding_tax: null, total_taxes: [{ amount: 2200 }] }), 10000, 'fallback: paid minus tax');
  assert.equal(invoiceBaseCents({ amount_paid: 0, total_excluding_tax: 29900 }), 0);
});

test('zero amount is skipped, with no write', async () => {
  assert.equal(commissionForInvoice(aff(), 'user-1', invoice({ amount_paid: 0, total_excluding_tax: 0 })), null);
  const { db, tables, calls } = fakeDb({ affiliates: [aff()], affiliate_referrals: [{ user_id: 'user-1', affiliate_id: 'aff-1' }] });
  assert.equal(await recordAffiliateCommission(db, invoice({ amount_paid: 0, total_excluding_tax: 0 })), 'skipped');
  assert.equal(tables.affiliate_commissions?.length ?? 0, 0);
  assert.deepEqual(calls, [], 'not even a read');
});

test('webhook step: records once per invoice; a duplicate delivery is ignored', async () => {
  const { db, tables } = fakeDb({ affiliates: [aff()], affiliate_referrals: [{ user_id: 'user-1', affiliate_id: 'aff-1' }] });
  assert.equal(await recordAffiliateCommission(db, invoice()), 'recorded');
  assert.equal(await recordAffiliateCommission(db, invoice()), 'duplicate');
  assert.equal(tables.affiliate_commissions.length, 1);
  const c = tables.affiliate_commissions[0];
  assert.equal(c.stripe_invoice_id, 'in_1');
  assert.equal(c.base_cents, 29900);
  assert.equal(c.pct, 20);
  assert.equal(c.commission_cents, 5980);
  assert.equal(c.user_id, 'user-1');
  // A renewal of a non-recurring affiliate: nothing.
  assert.equal(await recordAffiliateCommission(db, invoice({ id: 'in_2', billing_reason: 'subscription_cycle' })), 'skipped');
  assert.equal(tables.affiliate_commissions.length, 1);
});

test('webhook step: payer from the subscriptions row when the invoice has no userId; no referral → nothing', async () => {
  const { db, tables } = fakeDb({
    affiliates: [aff()],
    affiliate_referrals: [{ user_id: 'user-9', affiliate_id: 'aff-1' }],
    subscriptions: [{ user_id: 'user-9', stripe_subscription_id: 'sub_9' }],
  });
  const inv = invoice({ id: 'in_9', parent: { subscription_details: { metadata: {}, subscription: 'sub_9' } } });
  assert.equal(await recordAffiliateCommission(db, inv), 'recorded');
  assert.equal(tables.affiliate_commissions[0].user_id, 'user-9');
  assert.equal(await recordAffiliateCommission(db, invoice({ id: 'in_x', parent: { subscription_details: { metadata: { userId: 'stranger' } } } })), 'skipped');
  assert.equal(await recordAffiliateCommission(db, invoice({ id: 'in_y', parent: null })), 'skipped', 'one-off sale: no payer');
});

test('a bug or outage in affiliate code never throws into the webhook, the click or the sign-in', async () => {
  await quiet(async () => {
    assert.equal(await recordAffiliateCommission(explodingDb, invoice()), 'skipped');
    assert.equal(await recordAffiliateCommission(fakeDb({}, { failOn: 'affiliate_referrals' }).db, invoice()), 'skipped');
    assert.equal(await recordAffiliateCommission(null, invoice()), 'skipped');
    assert.equal(await recordAffiliateCommission(fakeDb().db, null as never), 'skipped');
    assert.equal(await trackReferralClick(explodingDb, 'dani'), null);
    assert.equal(await attributeReferral(explodingDb, 'user-1', 'dani'), 'none');
    assert.equal(await attributeReferral(fakeDb({ affiliates: [aff()] }, { failOn: 'affiliate_referrals' }).db, 'user-1', 'dani'), 'none');
  });
});

test('the webhook calls the step only after its own handling succeeded, wrapped so it cannot change the response', () => {
  const s = src('app/api/stripe/webhook/route.ts');
  const step = s.indexOf('await recordAffiliateCommission(db, event.data.object as Stripe.Invoice);');
  assert.ok(step > s.indexOf('const outcome = await processStripeEvent(event, deps);'), 'after processStripeEvent');
  assert.ok(step < s.indexOf("return NextResponse.json({ received: true, outcome });"), 'before the unchanged success response');
  assert.match(s, /if \(event\.type === 'invoice\.paid'\) \{\s*try \{\s*await recordAffiliateCommission\(db, event\.data\.object as Stripe\.Invoice\);\s*\} catch \(e\) \{/);
  assert.doesNotMatch(src('lib/billing/webhookSync.ts'), /affiliat/i, 'the sync contract itself is untouched');
});

// ── Click route ────────────────────────────────────────────────────────────

test('click: an active code records a click and returns the code; unknown, inactive or bad codes do nothing', async () => {
  const { db, tables } = fakeDb({ affiliates: [aff(), aff({ id: 'aff-2', code: 'off', active: false })] });
  assert.equal(await trackReferralClick(db, 'Dani'), 'dani', 'case-insensitive');
  assert.equal(tables.affiliate_clicks.length, 1);
  assert.equal(tables.affiliate_clicks[0].affiliate_id, 'aff-1');
  assert.equal(await trackReferralClick(db, 'nobody'), null);
  assert.equal(await trackReferralClick(db, 'off'), null, 'inactive');
  for (const bad of ['', 'a b', '../x', 'x'.repeat(41), '<script>', undefined, 42]) {
    assert.equal(await trackReferralClick(db, bad), null, String(bad));
  }
  assert.equal(await trackReferralClick(null, 'dani'), null, 'no database');
  assert.equal(tables.affiliate_clicks.length, 1);
});

test('click route: always redirects home, never throws, sets the cookie only for an active code', async () => {
  const req = new Request('https://www.anglemotion.com/r/dani');
  const { db, tables } = fakeDb({ affiliates: [aff(), aff({ id: 'aff-2', code: 'off', active: false })] });
  const cases: Array<[string, () => SupabaseClient | null, Promise<{ code: string }> | { code: string }, boolean]> = [
    ['active code', () => db, { code: 'dani' }, true],
    ['unknown code', () => db, { code: 'nobody' }, false],
    ['inactive code', () => db, { code: 'off' }, false],
    ['bad code', () => db, { code: '<x>' }, false],
    ['no database', () => null, { code: 'dani' }, false],
    ['database throws', () => explodingDb, { code: 'dani' }, false],
    ['client factory throws', () => { throw new Error('env'); }, { code: 'dani' }, false],
    ['params reject', () => db, Promise.reject(new Error('bad params')), false],
  ];
  for (const [name, getDb, params, cookie] of cases) {
    const res = await quiet(() => referralRedirect(req, params, getDb));
    assert.equal(res.status, 307, name);
    assert.equal(res.headers.get('location'), 'https://www.anglemotion.com/', name);
    const set = res.headers.get('set-cookie');
    if (cookie) assert.equal(set, 'am_ref=dani; Max-Age=5184000; Path=/; SameSite=Lax; Secure; HttpOnly', name);
    else assert.equal(set, null, name);
  }
  assert.equal(tables.affiliate_clicks.length, 1, 'only the active code counted');
  const bad = await quiet(() => referralRedirect({ url: 'not a url' } as Request, { code: 'dani' }, () => null));
  assert.equal(bad.headers.get('location'), 'https://www.anglemotion.com/', 'a broken request still redirects home');
  assert.match(src('app/r/[code]/route.ts'), /return referralRedirect\(req, ctx\.params, createSupabaseServiceClient\);/);
});

// ── Sign-in attribution ────────────────────────────────────────────────────

test('sign-in attribution: the first link wins and is never replaced', async () => {
  const { db, tables } = fakeDb({ affiliates: [aff(), aff({ id: 'aff-2', code: 'marco', view_token: 'w'.repeat(43) })] });
  assert.equal(await attributeReferral(db, 'user-1', 'dani'), 'attributed');
  assert.equal(await attributeReferral(db, 'user-1', 'marco'), 'kept');
  assert.equal(await attributeReferral(db, 'user-1', 'dani'), 'kept');
  assert.equal(tables.affiliate_referrals.length, 1);
  assert.equal(tables.affiliate_referrals[0].affiliate_id, 'aff-1');
  assert.equal(await attributeReferral(db, 'user-2', 'unknown'), 'none');
  assert.equal(await attributeReferral(db, null, 'dani'), 'none');
  assert.equal(tables.affiliate_referrals.length, 1);
});

test('the auth callback attributes after the session exchange, wrapped so it can never break sign-in', () => {
  const s = src('app/auth/callback/route.ts');
  assert.ok(s.indexOf('attributeReferral(') > s.indexOf('exchangeCodeForSession(code)'));
  assert.match(s, /try \{\s*const ref = cookieStore\.get\(REF_COOKIE\)\?\.value;[\s\S]*?attributeReferral\([\s\S]*?\} catch \(e\) \{/);
  assert.match(s, /return response;\s*\}\s*$/);
});

// ── Influencer page ────────────────────────────────────────────────────────

test('influencer page: totals and date / amount / status only — no coach ids, emails or names', async () => {
  const { db } = fakeDb({
    affiliates: [aff()],
    affiliate_clicks: [{ affiliate_id: 'aff-1' }, { affiliate_id: 'aff-1' }, { affiliate_id: 'other' }],
    affiliate_referrals: [{ user_id: 'secret-user-a', affiliate_id: 'aff-1' }, { user_id: 'secret-user-b', affiliate_id: 'aff-1' }],
    affiliate_commissions: [
      { affiliate_id: 'aff-1', user_id: 'secret-user-a', stripe_invoice_id: 'in_secret_1', commission_cents: 5980, base_cents: 29900, currency: 'eur', status: 'pending', created_at: '2026-10-16T10:00:00Z', email: 'coach@example.com' },
      { affiliate_id: 'aff-1', user_id: 'secret-user-a', stripe_invoice_id: 'in_secret_2', commission_cents: 1000, base_cents: 5000, currency: 'eur', status: 'paid', created_at: '2026-10-17T10:00:00Z' },
      { affiliate_id: 'aff-1', user_id: 'secret-user-b', stripe_invoice_id: 'in_secret_3', commission_cents: 700, base_cents: 3500, currency: 'eur', status: 'void', created_at: '2026-10-18T10:00:00Z' },
    ],
  });
  const view = await influencerView(db, 'v'.repeat(43));
  assert.ok(view);
  assert.deepEqual(view.summary, { clicks: 2, signups: 2, buyers: 1, pendingCents: 5980, paidCents: 1000 });
  for (const c of view.commissions) assert.deepEqual(Object.keys(c).sort(), ['amountCents', 'currency', 'date', 'status']);
  const json = JSON.stringify(view);
  for (const secret of ['secret-user', 'coach@example.com', 'in_secret', 'aff-1', 'v'.repeat(43)]) {
    assert.ok(!json.includes(secret), `leaks ${secret}`);
  }
  assert.equal(await influencerView(db, 'x'.repeat(43)), null, 'unknown token');
  assert.equal(await influencerView(db, 'short'), null);
  const page = src('app/affiliate/[token]/page.tsx');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /user_id|email|stripe_invoice/);
  assert.match(page, /robots: \{ index: false, follow: false/);
  assert.match(page, /if \(!view\) notFound\(\);/);
});

// ── Inputs, totals, wiring ─────────────────────────────────────────────────

test('codes and percentages are validated', () => {
  assert.equal(normalizeAffiliateCode(' Coach-Life-2 '), 'coach-life-2');
  for (const bad of ['', 'a_b', 'é', 'a/b', 'a b']) assert.equal(normalizeAffiliateCode(bad), null, bad);
  assert.equal(normalizePct('12.5'), 12.5);
  assert.equal(normalizePct(0), 0);
  assert.equal(normalizePct(100), 100);
  for (const bad of [-1, 101, 'x', '', null, Number.NaN]) assert.equal(normalizePct(bad), null, String(bad));
});

test('totals: buyers are distinct coaches with a non-void commission', () => {
  const s = summarizeAffiliate(10, 3, [
    { user_id: 'a', commission_cents: 100, status: 'pending' },
    { user_id: 'a', commission_cents: 200, status: 'paid' },
    { user_id: 'b', commission_cents: 300, status: 'void' },
    { user_id: 'c', commission_cents: 400, status: 'paid' },
  ]);
  assert.deepEqual(s, { clicks: 10, signups: 3, buyers: 2, pendingCents: 100, paidCents: 600 });
});

test('middleware: only /r/ and /affiliate/ were added to the public list; admin APIs use the admin gate', () => {
  const mw = src('middleware.ts');
  assert.match(mw, /pathname\.startsWith\('\/r\/'\) \|\|/);
  assert.match(mw, /pathname\.startsWith\('\/affiliate\/'\) \|\|/);
  for (const f of ['app/api/admin/affiliates/route.ts', 'app/api/admin/affiliates/[id]/route.ts', 'app/api/admin/affiliates/commissions/[id]/route.ts']) {
    const s = src(f);
    const handlers = s.match(/export async function (GET|POST|PATCH)/g) ?? [];
    const gates = s.match(/const access = await adminInvoicesAccess\(\);\s*if \('response' in access\) return access\.response;/g) ?? [];
    assert.ok(handlers.length > 0 && gates.length === handlers.length, `${f}: every handler is gated`);
  }
  assert.match(src('app/admin/affiliates/layout.tsx'), /if \(!session \|\| !isAdmin\(session\.email\)\) notFound\(\);/);
});

test('the migration: four tables, RLS on, no policies, unique invoice and first-wins referral, idempotent', () => {
  const sql = src('supabase/migrations/20261016120000_affiliates.sql');
  for (const t of ['affiliates', 'affiliate_clicks', 'affiliate_referrals', 'affiliate_commissions']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /user_id uuid primary key references auth\.users/);
  assert.match(sql, /stripe_invoice_id text not null unique/);
  assert.match(sql, /status text not null default 'pending' check \(status in \('pending', 'paid', 'void'\)\)/);
  assert.match(sql, /code text not null unique check \(code ~ '\^\[a-z0-9-\]\+\$'\)/);
});
