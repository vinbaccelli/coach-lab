import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commissionForInvoice, normalizeAffiliateCode, REF_COOKIE, REF_COOKIE_MAX_AGE_S, summarizeAffiliate,
  type Affiliate, type AffiliateSummary, type CommissionStatus, type InvoiceFacts,
} from '@/lib/affiliates';

/**
 * Affiliate reads and writes (service-role client only: the four tables have
 * RLS on and no client policies). Rules live in lib/affiliates.ts.
 *
 * The three entry points that run inside other flows — the /r/<code> click,
 * the sign-in callback and the Stripe webhook — NEVER throw: any failure is
 * logged and reported as "nothing done", so an affiliate bug can never block
 * a visit, a sign-in or a payment.
 */

const AFFILIATE_COLUMNS = 'id, name, code, view_token, commission_pct, recurring, active, created_at';

const warn = (msg: string, e: unknown) => console.warn(`[affiliates] ${msg}:`, e instanceof Error ? e.message : e);

async function activeAffiliateByCode(db: SupabaseClient, code: string): Promise<Affiliate | null> {
  const { data, error } = await db.from('affiliates').select(AFFILIATE_COLUMNS).eq('code', code).eq('active', true).maybeSingle<Affiliate>();
  if (error) throw new Error(`affiliates read failed: ${error.message}`);
  return data ?? null;
}

/**
 * A visit to /r/<code>. Records a click for an ACTIVE affiliate and returns the
 * code to store in the cookie; returns null for an unknown or inactive code,
 * a missing database, or any error. Never throws.
 */
export async function trackReferralClick(db: SupabaseClient | null, rawCode: unknown): Promise<string | null> {
  try {
    const code = normalizeAffiliateCode(rawCode);
    if (!code || !db) return null;
    const affiliate = await activeAffiliateByCode(db, code);
    if (!affiliate) return null;
    const { error } = await db.from('affiliate_clicks').insert({ affiliate_id: affiliate.id });
    if (error) warn('click insert failed', error.message);
    return code;
  } catch (e) {
    warn('click tracking failed', e);
    return null;
  }
}

/**
 * The whole /r/<code> handler (app/r/[code]/route.ts), as a plain web Response
 * so it is testable without Next. Always a redirect to the home page: an
 * ACTIVE affiliate's code also records a click and sets the first-party cookie
 * am_ref=<code> (60 days, SameSite=Lax, Secure, HttpOnly, path /; it holds only
 * the code, which is a-z0-9- by construction). Never throws.
 */
export async function referralRedirect(
  req: Request,
  params: Promise<{ code: string }> | { code: string },
  getDb: () => SupabaseClient | null,
): Promise<Response> {
  let home = 'https://www.anglemotion.com/';
  try {
    home = new URL('/', req.url).toString();
  } catch {
    /* keep the default */
  }
  const headers = new Headers({ Location: home, 'Cache-Control': 'no-store' });
  try {
    const { code } = await params;
    const tracked = await trackReferralClick(getDb(), code);
    if (tracked) {
      headers.append('Set-Cookie', `${REF_COOKIE}=${tracked}; Max-Age=${REF_COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax; Secure; HttpOnly`);
    }
  } catch (e) {
    warn('/r/ failed, redirecting anyway', e);
  }
  return new Response(null, { status: 307, headers });
}

/**
 * After a sign-in: if the am_ref cookie names an active affiliate, record the
 * coach as its referral. The first link wins: an existing referral is never
 * replaced (ON CONFLICT DO NOTHING). Never throws.
 */
export async function attributeReferral(
  db: SupabaseClient | null,
  userId: string | null | undefined,
  rawCode: unknown,
): Promise<'attributed' | 'kept' | 'none'> {
  try {
    const code = normalizeAffiliateCode(rawCode);
    if (!code || !db || !userId) return 'none';
    const affiliate = await activeAffiliateByCode(db, code);
    if (!affiliate) return 'none';
    const { data, error } = await db
      .from('affiliate_referrals')
      .upsert({ user_id: userId, affiliate_id: affiliate.id }, { onConflict: 'user_id', ignoreDuplicates: true })
      .select('user_id');
    if (error) throw new Error(`affiliate_referrals upsert failed: ${error.message}`);
    return data && data.length > 0 ? 'attributed' : 'kept';
  } catch (e) {
    warn('signup attribution failed', e);
    return 'none';
  }
}

/** The Stripe invoice fields the commission step reads (a subset of Stripe.Invoice). */
export type PaidInvoice = InvoiceFacts & {
  parent?: {
    subscription_details?: {
      metadata?: Record<string, string> | null;
      subscription?: string | { id: string } | null;
    } | null;
  } | null;
};

/**
 * The coach who paid: the `userId` the checkout put on the subscription
 * (snapshotted onto the invoice), else the subscriptions row the webhook has
 * just synced for that subscription.
 */
async function payerUserId(db: SupabaseClient, inv: PaidInvoice): Promise<string | null> {
  const details = inv.parent?.subscription_details;
  const fromMeta = details?.metadata?.userId;
  if (fromMeta) return fromMeta;
  const sub = details?.subscription;
  const subId = typeof sub === 'string' ? sub : sub?.id ?? null;
  if (!subId) return null;
  const { data, error } = await db.from('subscriptions').select('user_id').eq('stripe_subscription_id', subId).maybeSingle<{ user_id: string }>();
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);
  return data?.user_id ?? null;
}

/**
 * invoice.paid, best effort: a commission for the affiliate who referred the
 * payer, when one is due (lib/affiliates.ts commissionForInvoice). Idempotent
 * through the unique stripe_invoice_id. Never throws, and never touches the
 * subscription or the fiscal invoice.
 */
export async function recordAffiliateCommission(
  db: SupabaseClient | null,
  inv: PaidInvoice,
): Promise<'recorded' | 'duplicate' | 'skipped'> {
  try {
    if (!db || !inv?.id || !(inv.amount_paid && inv.amount_paid > 0)) return 'skipped';
    const userId = await payerUserId(db, inv);
    if (!userId) return 'skipped';
    const { data: ref, error: refError } = await db
      .from('affiliate_referrals').select('affiliate_id').eq('user_id', userId).maybeSingle<{ affiliate_id: string }>();
    if (refError) throw new Error(`affiliate_referrals read failed: ${refError.message}`);
    if (!ref) return 'skipped';
    const { data: affiliate, error: affError } = await db
      .from('affiliates').select(AFFILIATE_COLUMNS).eq('id', ref.affiliate_id).maybeSingle<Affiliate>();
    if (affError) throw new Error(`affiliates read failed: ${affError.message}`);
    if (!affiliate) return 'skipped';
    const row = commissionForInvoice(affiliate, userId, inv);
    if (!row) return 'skipped';
    const { data, error } = await db
      .from('affiliate_commissions')
      .upsert(row, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`affiliate_commissions insert failed: ${error.message}`);
    return data && data.length > 0 ? 'recorded' : 'duplicate';
  } catch (e) {
    warn(`commission for invoice ${inv?.id ?? '?'} failed`, e);
    return 'skipped';
  }
}

async function countFor(db: SupabaseClient, table: 'affiliate_clicks' | 'affiliate_referrals', affiliateId: string): Promise<number> {
  const { count, error } = await db.from(table).select('affiliate_id', { count: 'exact', head: true }).eq('affiliate_id', affiliateId);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

export type AdminCommission = {
  id: string; stripe_invoice_id: string; base_cents: number; pct: number; commission_cents: number;
  currency: string; status: CommissionStatus; paid_at: string | null; created_at: string;
};
export type AdminAffiliate = Affiliate & { summary: AffiliateSummary; commissions: AdminCommission[] };

/** /admin/affiliates: every affiliate with its totals and commissions (no coach data). */
export async function affiliateOverview(db: SupabaseClient): Promise<AdminAffiliate[]> {
  const { data: affiliates, error } = await db.from('affiliates').select(AFFILIATE_COLUMNS).order('created_at', { ascending: true });
  if (error) throw new Error(`affiliates read failed: ${error.message}`);
  const { data: rows, error: cError } = await db
    .from('affiliate_commissions')
    .select('id, affiliate_id, user_id, stripe_invoice_id, base_cents, pct, commission_cents, currency, status, paid_at, created_at')
    .order('created_at', { ascending: false });
  if (cError) throw new Error(`affiliate_commissions read failed: ${cError.message}`);
  const all = (rows ?? []) as Array<AdminCommission & { affiliate_id: string; user_id: string }>;
  return Promise.all(((affiliates ?? []) as Affiliate[]).map(async (a) => {
    const mine = all.filter((c) => c.affiliate_id === a.id);
    const [clicks, signups] = await Promise.all([countFor(db, 'affiliate_clicks', a.id), countFor(db, 'affiliate_referrals', a.id)]);
    return {
      ...a,
      summary: summarizeAffiliate(clicks, signups, mine),
      commissions: mine.map(({ id, stripe_invoice_id, base_cents, pct, commission_cents, currency, status, paid_at, created_at }) => (
        { id, stripe_invoice_id, base_cents, pct, commission_cents, currency, status, paid_at, created_at }
      )),
    };
  }));
}

export type InfluencerView = {
  name: string;
  code: string;
  active: boolean;
  summary: AffiliateSummary;
  /** Date, amount and status only: nothing that identifies the coach. */
  commissions: Array<{ date: string; amountCents: number; currency: string; status: CommissionStatus }>;
};

/** /affiliate/<token>: the affiliate's own totals. Null for an unknown token. */
export async function influencerView(db: SupabaseClient, rawToken: unknown): Promise<InfluencerView | null> {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 200) return null;
  const { data: a, error } = await db
    .from('affiliates').select('id, name, code, active').eq('view_token', rawToken)
    .maybeSingle<{ id: string; name: string; code: string; active: boolean }>();
  if (error) throw new Error(`affiliates read failed: ${error.message}`);
  if (!a) return null;
  const { data: rows, error: cError } = await db
    .from('affiliate_commissions').select('user_id, commission_cents, currency, status, created_at')
    .eq('affiliate_id', a.id).order('created_at', { ascending: false });
  if (cError) throw new Error(`affiliate_commissions read failed: ${cError.message}`);
  const commissions = (rows ?? []) as Array<{ user_id: string; commission_cents: number; currency: string; status: CommissionStatus; created_at: string }>;
  const [clicks, signups] = await Promise.all([countFor(db, 'affiliate_clicks', a.id), countFor(db, 'affiliate_referrals', a.id)]);
  return {
    name: a.name,
    code: a.code,
    active: a.active,
    summary: summarizeAffiliate(clicks, signups, commissions),
    commissions: commissions.map((c) => ({ date: c.created_at, amountCents: c.commission_cents, currency: c.currency, status: c.status })),
  };
}
