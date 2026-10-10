import type Stripe from 'stripe';

/**
 * The fiscal-invoice record taken from a PAID Stripe payment. Pure, so it is
 * unit-tested without Stripe (tests/webhookSync.test.ts, tests/invoicingDraft.test.ts).
 *
 * Two sources (D10):
 *  - 'subscription': a paid subscription invoice (invoice.paid);
 *  - 'one_off': a paid one-off Checkout — payment links for coaching, the
 *    ebook, analyses… (checkout.session.completed / async_payment_succeeded).
 *
 * This is a snapshot of what Stripe holds at payment time — who paid, where,
 * what for, and the Stripe IDs that prove it. It is NOT the fattura
 * elettronica: number, date, VAT treatment and XML are added when Vin issues
 * it from /admin/invoices (lib/billing/invoicing/fatturaPA.ts).
 */

/** EU member states (ISO 3166-1 alpha-2), Italy included. Data, not a tax rule. */
export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

export type CustomerRegion = 'IT' | 'EU' | 'NON_EU';
export type CustomerCategory = 'IT_B2C' | 'IT_B2B' | 'EU_B2C' | 'EU_B2B' | 'NON_EU_B2C' | 'NON_EU_B2B';
export const CUSTOMER_CATEGORIES: CustomerCategory[] = ['IT_B2C', 'IT_B2B', 'EU_B2C', 'EU_B2B', 'NON_EU_B2C', 'NON_EU_B2B'];

/** IT, another EU state, or outside the EU. Unknown country counts as NON_EU. */
export function customerRegion(country: string | null | undefined): CustomerRegion {
  const c = (country ?? '').toUpperCase();
  if (c === 'IT') return 'IT';
  return EU_COUNTRIES.has(c) ? 'EU' : 'NON_EU';
}

/**
 * One of six kinds. B2B means the customer gave a VAT / tax number for the
 * business (an Italian Partita IVA, an EU VAT ID, a foreign business tax ID).
 * A company NAME alone does not make a sale B2B: the tax treatment depends on
 * the customer being a registered business, so it can't be claimed by typing
 * a name.
 */
export function customerCategory(region: CustomerRegion, hasBusinessTaxId: boolean): CustomerCategory {
  return `${region}_${hasBusinessTaxId ? 'B2B' : 'B2C'}` as CustomerCategory;
}

export interface FiscalInvoiceDraft {
  user_id: string | null;
  source: 'subscription' | 'one_off';
  stripe_invoice_id: string | null;
  stripe_invoice_number: string | null;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string;
  amount_cents: number;
  currency: string;
  plan: string | null;
  billing_interval: string | null;
  period_start: string | null;
  period_end: string | null;
  /** One-off: what was bought (Checkout line item names). */
  product_description: string | null;
  customer_name: string | null;
  customer_email: string | null;
  business_name: string | null;
  customer_address: Stripe.Address | null;
  customer_country: string | null;
  customer_region: CustomerRegion;
  /** A business tax ID was given (see customerCategory). */
  is_business: boolean;
  customer_category: CustomerCategory;
  vat_id: string | null;
  vat_id_type: string | null;
}

function idOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
}

const iso = (unixSeconds: number | null | undefined) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

/** Prefer an EU VAT number, else whatever tax ID was given at checkout. */
function pickTaxId(ids: Array<{ type: string; value: string | null }> | null | undefined) {
  const list = (ids ?? []).filter((t) => !!t.value);
  return list.find((t) => t.type === 'eu_vat') ?? list[0] ?? null;
}

function customerFields(
  address: Stripe.Address | null,
  taxIds: Array<{ type: string; value: string | null }> | null | undefined,
) {
  const country = address?.country ? address.country.toUpperCase() : null;
  const taxId = pickTaxId(taxIds);
  const region = customerRegion(country);
  return {
    customer_address: address,
    customer_country: country,
    customer_region: region,
    is_business: !!taxId,
    customer_category: customerCategory(region, !!taxId),
    vat_id: taxId?.value ?? null,
    vat_id_type: taxId?.type ?? null,
  };
}

/**
 * Should this paid invoice become a fiscal invoice? Only a SUBSCRIPTION invoice
 * with money taken: a €0 invoice (100% coupon, trial) is not a sale, and a
 * one-off Checkout's invoice (if a payment link creates one) is recorded from
 * the Checkout Session instead, so it is never recorded twice.
 */
export function isFiscalSale(invoice: Pick<Stripe.Invoice, 'amount_paid' | 'parent'>): boolean {
  return (invoice.amount_paid ?? 0) > 0 && !!invoice.parent?.subscription_details?.subscription;
}

export function fiscalDraftFromInvoice(
  invoice: Stripe.Invoice,
  customer: Pick<Stripe.Customer, 'name' | 'email' | 'address'> & { business_name?: string | null } | null,
  /** plan and interval come from the subscription the webhook just re-read. */
  ctx: { userId: string | null; plan: string | null; interval: 'month' | 'year' | null; now: Date },
): FiscalInvoiceDraft {
  const line = invoice.lines?.data?.[0];
  const payment = invoice.payments?.data?.[0] as { payment?: { payment_intent?: unknown } } | undefined;
  return {
    user_id: ctx.userId,
    source: 'subscription',
    stripe_invoice_id: invoice.id!,
    stripe_invoice_number: invoice.number ?? null,
    stripe_checkout_session_id: null,
    stripe_customer_id: idOf(invoice.customer),
    stripe_subscription_id: idOf(invoice.parent?.subscription_details?.subscription),
    stripe_payment_intent_id: idOf(payment?.payment?.payment_intent),
    paid_at: iso(invoice.status_transitions?.paid_at) ?? ctx.now.toISOString(),
    amount_cents: invoice.amount_paid,
    currency: (invoice.currency ?? 'eur').toUpperCase(),
    plan: ctx.plan,
    billing_interval: ctx.interval,
    period_start: iso(line?.period?.start),
    period_end: iso(line?.period?.end),
    product_description: null,
    customer_name: invoice.customer_name ?? customer?.name ?? null,
    customer_email: invoice.customer_email ?? customer?.email ?? null,
    business_name: customer?.business_name?.trim() || null,
    ...customerFields(invoice.customer_address ?? customer?.address ?? null, invoice.customer_tax_ids),
  };
}

/** A one-off Checkout counts once it is paid (async methods: when the payment succeeds). */
export function isOneOffSale(session: Pick<Stripe.Checkout.Session, 'mode' | 'payment_status' | 'amount_total'>): boolean {
  return session.mode === 'payment' && session.payment_status === 'paid' && (session.amount_total ?? 0) > 0;
}

export function fiscalDraftFromCheckout(
  session: Stripe.Checkout.Session,
  /** Names of what was bought, e.g. ["Spin Mechanics ebook"]. */
  lineItemNames: string[],
  ctx: { now: Date; paidAt?: Date },
): FiscalInvoiceDraft {
  const d = session.customer_details;
  const names = lineItemNames.map((n) => n.trim()).filter(Boolean);
  return {
    user_id: session.client_reference_id ?? session.metadata?.userId ?? null,
    source: 'one_off',
    stripe_invoice_id: idOf(session.invoice),
    stripe_invoice_number: null,
    stripe_checkout_session_id: session.id,
    stripe_customer_id: idOf(session.customer),
    stripe_subscription_id: null,
    stripe_payment_intent_id: idOf(session.payment_intent),
    paid_at: (ctx.paidAt ?? ctx.now).toISOString(),
    amount_cents: session.amount_total ?? 0,
    currency: (session.currency ?? 'eur').toUpperCase(),
    plan: null,
    billing_interval: null,
    period_start: null,
    period_end: null,
    product_description: names.length ? names.join(', ') : null,
    customer_name: d?.name ?? null,
    customer_email: d?.email ?? null,
    business_name: d?.business_name?.trim() || null,
    ...customerFields(d?.address ?? null, d?.tax_ids),
  };
}
