import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fiscalDraftFromCheckout, fiscalDraftFromInvoice, isFiscalSale, isOneOffSale, productTypeFor,
  type DraftProductType, type FiscalInvoiceDraft,
} from '@/lib/billing/invoicing/draft';
import { tierForPriceId } from '@/lib/stripe';

/**
 * Admin: past Stripe payments with NO fiscal-invoice record (D10) — paid
 * one-off Checkouts (payment links) and paid subscription invoices since a
 * date. Stripe data never proves an Italian invoice exists, so nothing is
 * created or issued automatically: GET only lists them; POST imports the ones
 * Vin picks into the REVIEW queue (or straight to "already invoiced
 * elsewhere" with its reference). Each payment gets at most one record.
 *
 * Live query (CLAUDE.md §6): Stripe is read only when Vin opens this list
 * (admin-only, on demand), at most MAX_ITEMS sessions + invoices per call.
 */
const MAX_ITEMS = 300;

type Missing = {
  kind: 'checkout' | 'invoice'; id: string; paid_at: string; amount_cents: number; currency: string;
  customer: string | null; email: string | null; country: string | null; what: string | null; source: 'one_off' | 'subscription';
  livemode: boolean;
};

function fromDate(req: Request): number {
  const q = new URL(req.url).searchParams.get('from');
  const d = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? new Date(`${q}T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  return Math.floor(d.getTime() / 1000);
}

export async function GET(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  if (!stripe) return NextResponse.json({ error: 'STRIPE_SECRET_KEY is not set' }, { status: 503 });
  const since = fromDate(req);

  const { data: known, error } = await access.db.from('fiscal_invoices').select('stripe_invoice_id, stripe_checkout_session_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const knownInvoices = new Set((known ?? []).map((r) => r.stripe_invoice_id).filter(Boolean));
  const knownSessions = new Set((known ?? []).map((r) => r.stripe_checkout_session_id).filter(Boolean));

  const missing: Missing[] = [];
  try {
    let n = 0;
    for await (const s of stripe.checkout.sessions.list({ status: 'complete', created: { gte: since }, limit: 100, expand: ['data.line_items'] })) {
      if (++n > MAX_ITEMS) break;
      if (!isOneOffSale(s) || knownSessions.has(s.id) || (s.invoice && knownInvoices.has(String(typeof s.invoice === 'string' ? s.invoice : s.invoice.id)))) continue;
      missing.push({
        kind: 'checkout', id: s.id, paid_at: new Date(s.created * 1000).toISOString(), amount_cents: s.amount_total ?? 0,
        currency: (s.currency ?? 'eur').toUpperCase(), customer: s.customer_details?.name ?? null, email: s.customer_details?.email ?? null,
        country: s.customer_details?.address?.country ?? null,
        what: s.line_items?.data.map((i) => i.description).filter(Boolean).join(', ') || null, source: 'one_off',
        livemode: s.livemode,
      });
    }
    n = 0;
    for await (const inv of stripe.invoices.list({ status: 'paid', created: { gte: since }, limit: 100 })) {
      if (++n > MAX_ITEMS) break;
      if (!isFiscalSale(inv) || knownInvoices.has(inv.id!)) continue;
      missing.push({
        kind: 'invoice', id: inv.id!, paid_at: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString(),
        amount_cents: inv.amount_paid, currency: (inv.currency ?? 'eur').toUpperCase(), customer: inv.customer_name ?? null,
        email: inv.customer_email ?? null, country: inv.customer_address?.country ?? null,
        what: inv.lines?.data?.[0]?.description ?? 'Subscription', source: 'subscription',
        livemode: inv.livemode,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: `Stripe read failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
  missing.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  return NextResponse.json({ since: new Date(since * 1000).toISOString().slice(0, 10), missing }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Record payments Vin picked. `action`:
 *  - "review"   (default) into the review queue (status 'review'): nothing is
 *               invoiced until Vin decides each one (to issue / already
 *               invoiced elsewhere / void);
 *  - "external" already invoiced outside AngleMotion; `reference` required
 *               (e.g. "FatturAE 63/2026").
 * `items`: up to 50 { kind, id } per call. Idempotent: a payment that already
 * has a record is skipped (never a second record).
 */
export async function POST(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  if (!stripe) return NextResponse.json({ error: 'STRIPE_SECRET_KEY is not set' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string; id?: string; items?: Array<{ kind?: string; id?: string }>; action?: string; reference?: unknown;
  };
  const items = (body.items ?? (body.kind ? [{ kind: body.kind, id: body.id }] : [])).slice(0, 50);
  if (!items.length || items.some((i) => (i.kind !== 'checkout' && i.kind !== 'invoice') || typeof i.id !== 'string')) {
    return NextResponse.json({ error: 'items: [{ kind: "checkout" | "invoice", id }] are required' }, { status: 400 });
  }
  const action = body.action ?? 'review';
  const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 200) : '';
  if (action !== 'review' && action !== 'external') return NextResponse.json({ error: 'action must be "review" or "external"' }, { status: 400 });
  if (action === 'external' && !reference) return NextResponse.json({ error: 'Say where it was invoiced, e.g. "FatturAE 63/2026"' }, { status: 400 });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of items as Array<{ kind: 'checkout' | 'invoice'; id: string }>) {
    try {
      const draft = await draftFor(item, access.db);
      if (!draft) { results.push({ id: item.id, ok: false, error: 'Not a paid sale' }); continue; }
      const row = {
        ...draft,
        status: action === 'external' ? 'external' : 'review',
        external_reference: action === 'external' ? reference : null,
        note: 'Historical payment imported from Stripe for review',
      };
      const onConflict = draft.source === 'one_off' ? 'stripe_checkout_session_id' : 'stripe_invoice_id';
      const { error } = await access.db.from('fiscal_invoices').upsert(row, { onConflict, ignoreDuplicates: true });
      results.push(error ? { id: item.id, ok: false, error: error.message } : { id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: `Stripe read failed: ${e instanceof Error ? e.message : e}` });
    }
  }
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length === results.length ? 502 : 200 });
}

async function draftFor(item: { kind: 'checkout' | 'invoice'; id: string }, db: SupabaseClient): Promise<FiscalInvoiceDraft | null> {
  if (!stripe) return null;
  const now = new Date();
  if (item.kind === 'checkout') {
    const s = await stripe.checkout.sessions.retrieve(item.id);
    if (!isOneOffSale(s)) return null;
    const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 20 });
    const productIds = li.data.map((i) => idOf(i.price?.product)).filter((v): v is string => !!v);
    const map = new Map<string, DraftProductType>();
    if (productIds.length) {
      const { data } = await db.from('invoice_product_types').select('stripe_product_id, product_type').in('stripe_product_id', productIds);
      for (const r of data ?? []) map.set(r.stripe_product_id as string, r.product_type as DraftProductType);
    }
    return fiscalDraftFromCheckout(s, { names: li.data.map((i) => i.description ?? ''), productIds }, {
      now, paidAt: new Date(s.created * 1000), productType: productTypeFor(productIds, map),
    });
  }
  const inv = await stripe.invoices.retrieve(item.id);
  if (!isFiscalSale(inv)) return null;
  const subId = inv.parent?.subscription_details?.subscription;
  const sub = subId ? await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id) : null;
  const custId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
  const cust = custId ? await stripe.customers.retrieve(custId) : null;
  const interval = sub?.items?.data?.[0]?.price?.recurring?.interval;
  const draft = fiscalDraftFromInvoice(inv, cust && !('deleted' in cust && cust.deleted) ? (cust as Stripe.Customer) : null, {
    userId: sub?.metadata?.userId ?? null,
    plan: tierForPriceId(sub?.items?.data?.[0]?.price?.id) ?? sub?.metadata?.plan ?? null,
    interval: interval === 'month' || interval === 'year' ? interval : null,
    now,
  });
  if (!draft.stripe_payment_intent_id && inv.id) {
    const pays = await stripe.invoicePayments.list({ invoice: inv.id, limit: 3 });
    const paid = pays.data.find((p) => p.status === 'paid') ?? pays.data[0];
    draft.stripe_payment_intent_id = paid?.payment?.type === 'payment_intent' ? idOf(paid.payment.payment_intent) : null;
  }
  return draft;
}

const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
