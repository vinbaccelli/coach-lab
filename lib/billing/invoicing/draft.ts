import type Stripe from 'stripe';

/**
 * The fiscal-invoice record taken from a PAID Stripe invoice (P1/P5). Pure, so
 * it is unit-tested without Stripe (tests/invoicingDraft.test.ts).
 *
 * This is a snapshot of what Stripe holds at payment time — who paid, where
 * they are, what they paid for and the Stripe IDs that prove it. It is NOT the
 * fattura elettronica: the number, date, VAT treatment and XML are added when
 * Vin issues it from /admin/invoices (lib/billing/invoicing/fatturaPA.ts).
 */

/** EU member states (ISO 3166-1 alpha-2), Italy included. Data, not a tax rule. */
export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

export type CustomerRegion = 'IT' | 'EU' | 'NON_EU';

/** IT, another EU state, or outside the EU. Unknown country counts as NON_EU. */
export function customerRegion(country: string | null | undefined): CustomerRegion {
  const c = (country ?? '').toUpperCase();
  if (c === 'IT') return 'IT';
  return EU_COUNTRIES.has(c) ? 'EU' : 'NON_EU';
}

export interface FiscalInvoiceDraft {
  user_id: string | null;
  stripe_invoice_id: string;
  stripe_invoice_number: string | null;
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
  customer_name: string | null;
  customer_email: string | null;
  business_name: string | null;
  customer_address: Stripe.Address | null;
  customer_country: string | null;
  customer_region: CustomerRegion;
  /** A business customer: a tax ID was given, or a business name. */
  is_business: boolean;
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

/**
 * Should this paid invoice become a fiscal invoice? Only when money changed
 * hands: a €0 invoice (100% coupon, trial) is not a sale.
 */
export function isFiscalSale(invoice: Pick<Stripe.Invoice, 'amount_paid'>): boolean {
  return (invoice.amount_paid ?? 0) > 0;
}

export function fiscalDraftFromInvoice(
  invoice: Stripe.Invoice,
  customer: Pick<Stripe.Customer, 'name' | 'email' | 'address'> & { business_name?: string | null } | null,
  /** plan and interval come from the subscription the webhook just re-read. */
  ctx: { userId: string | null; plan: string | null; interval: 'month' | 'year' | null; now: Date },
): FiscalInvoiceDraft {
  const address = invoice.customer_address ?? customer?.address ?? null;
  const country = address?.country ? address.country.toUpperCase() : null;
  // Prefer an EU VAT number, else whatever tax ID was given at checkout.
  const taxIds = invoice.customer_tax_ids ?? [];
  const taxId = taxIds.find((t) => t.type === 'eu_vat') ?? taxIds[0] ?? null;
  const businessName = customer?.business_name?.trim() || null;
  const line = invoice.lines?.data?.[0];
  const payment = invoice.payments?.data?.[0] as { payment?: { payment_intent?: unknown } } | undefined;

  return {
    user_id: ctx.userId,
    stripe_invoice_id: invoice.id!,
    stripe_invoice_number: invoice.number ?? null,
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
    customer_name: invoice.customer_name ?? customer?.name ?? null,
    customer_email: invoice.customer_email ?? customer?.email ?? null,
    business_name: businessName,
    customer_address: address,
    customer_country: country,
    customer_region: customerRegion(country),
    is_business: !!taxId || !!businessName,
    vat_id: taxId?.value ?? null,
    vat_id_type: taxId?.type ?? null,
  };
}
