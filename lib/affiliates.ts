/**
 * Affiliate rules (pure; the database side is lib/affiliates.server.ts).
 *
 * An affiliate shares https://www.anglemotion.com/r/<code>. A visit sets the
 * first-party cookie am_ref=<code>; the coach's next sign-in records them as
 * that affiliate's referral (first link wins); each paid invoice of a referred
 * coach may then earn a commission. The cookie holds only the code.
 */

export const REF_COOKIE = 'am_ref';
export const REF_COOKIE_MAX_AGE_S = 60 * 24 * 60 * 60; // 60 days
export const PUBLIC_SITE = 'https://www.anglemotion.com';

export type Affiliate = {
  id: string;
  name: string;
  code: string;
  view_token: string;
  commission_pct: number;
  recurring: boolean;
  active: boolean;
  created_at?: string;
};

export type CommissionStatus = 'pending' | 'paid' | 'void';

export type CommissionRow = {
  affiliate_id: string;
  user_id: string;
  stripe_invoice_id: string;
  base_cents: number;
  pct: number;
  commission_cents: number;
  currency: string;
};

/** A link code: lowercase letters, digits and hyphens. Null when not one. */
export function normalizeAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(code) ? code : null;
}

/** A commission percentage in 0..100 (decimals allowed). Null when not one. */
export function normalizePct(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Only an account created this recently becomes a referral (a NEW signup). */
export const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
/** Tolerated clock difference between Supabase and this server. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Is this a brand-new account? True only when the auth user's `created_at` is
 * within the last 15 minutes (a minute of clock skew either way tolerated).
 * A missing or unreadable date counts as NOT new, so an existing coach who
 * signs in again through a link never becomes a referral.
 */
export function isNewAccount(createdAt: unknown, nowMs: number): boolean {
  if (typeof createdAt !== 'string' || !createdAt) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const age = nowMs - created;
  return age >= -CLOCK_SKEW_MS && age <= NEW_ACCOUNT_WINDOW_MS;
}

export const referralLink = (code: string) => `${PUBLIC_SITE}/r/${code}`;
export const influencerPagePath = (viewToken: string) => `/affiliate/${viewToken}`;

/** The invoice facts the commission rule needs (a subset of Stripe.Invoice). */
export type InvoiceFacts = {
  id?: string | null;
  billing_reason?: string | null;
  amount_paid?: number | null;
  total_excluding_tax?: number | null;
  total_taxes?: Array<{ amount?: number | null }> | null;
  currency?: string | null;
};

/**
 * The commission base: what the coach actually paid, after discounts, without
 * tax.
 *
 * Uses `total_excluding_tax`, which is after discounts and before tax, and caps
 * it at `amount_paid` so an applied account credit never inflates it. When
 * Stripe leaves `total_excluding_tax` empty, it falls back to `amount_paid`
 * minus the invoice's taxes (`total_taxes`). Never negative.
 */
export function invoiceBaseCents(inv: InvoiceFacts): number {
  const paid = Math.max(0, Math.round(inv.amount_paid ?? 0));
  if (paid === 0) return 0;
  if (typeof inv.total_excluding_tax === 'number') {
    return Math.max(0, Math.min(Math.round(inv.total_excluding_tax), paid));
  }
  const tax = (inv.total_taxes ?? []).reduce((s, t) => s + Math.max(0, Math.round(t?.amount ?? 0)), 0);
  return Math.max(0, paid - tax);
}

/**
 * The commission row for one paid invoice of a referred coach, or null when
 * none is due:
 *  - the affiliate must be active;
 *  - only the first payment (billing_reason 'subscription_create') earns,
 *    unless the affiliate is recurring;
 *  - a zero amount earns nothing.
 * The affiliate's percentage is copied onto the row, so a later change never
 * rewrites what was earned.
 */
export function commissionForInvoice(
  affiliate: Pick<Affiliate, 'id' | 'commission_pct' | 'recurring' | 'active'>,
  userId: string,
  inv: InvoiceFacts,
): CommissionRow | null {
  if (!affiliate.active || !inv.id) return null;
  if (!affiliate.recurring && inv.billing_reason !== 'subscription_create') return null;
  const base = invoiceBaseCents(inv);
  if (base <= 0) return null;
  const pct = Number(affiliate.commission_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return {
    affiliate_id: affiliate.id,
    user_id: userId,
    stripe_invoice_id: inv.id,
    base_cents: base,
    pct,
    commission_cents: Math.round((base * pct) / 100),
    currency: (inv.currency ?? 'eur').toLowerCase(),
  };
}

export type AffiliateSummary = {
  clicks: number;
  signups: number;
  /** Distinct coaches with at least one commission that is not void. */
  buyers: number;
  pendingCents: number;
  paidCents: number;
};

/** Totals for one affiliate from its counts and its commission rows. */
export function summarizeAffiliate(
  clicks: number,
  signups: number,
  commissions: Array<{ user_id: string; commission_cents: number; status: string }>,
): AffiliateSummary {
  const buyers = new Set<string>();
  let pendingCents = 0;
  let paidCents = 0;
  for (const c of commissions) {
    if (c.status === 'void') continue;
    buyers.add(c.user_id);
    if (c.status === 'pending') pendingCents += c.commission_cents;
    if (c.status === 'paid') paidCents += c.commission_cents;
  }
  return { clicks, signups, buyers: buyers.size, pendingCents, paidCents };
}

/** EUR amount from cents, e.g. "€12.50". */
export function formatEur(cents: number): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}
