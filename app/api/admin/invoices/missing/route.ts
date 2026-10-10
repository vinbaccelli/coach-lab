import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import {
  fiscalDraftFromCheckout, fiscalDraftFromInvoice, isFiscalSale, isOneOffSale, type FiscalInvoiceDraft,
} from '@/lib/billing/invoicing/draft';
import { tierForPriceId } from '@/lib/stripe';

/**
 * Admin: past Stripe payments with NO fiscal-invoice record (D10) — paid
 * one-off Checkouts (payment links) and paid subscription invoices since a
 * date. Nothing is created automatically: GET only lists them; POST records
 * ONE payment Vin picked, either "to issue" or "already invoiced elsewhere"
 * (status 'external', so it stops being listed and is never invoiced twice).
 *
 * Live query (CLAUDE.md §6): Stripe is read only when Vin opens this list
 * (admin-only, on demand), at most MAX_ITEMS sessions + invoices per call.
 */
const MAX_ITEMS = 300;

type Missing = {
  kind: 'checkout' | 'invoice'; id: string; paid_at: string; amount_cents: number; currency: string;
  customer: string | null; email: string | null; country: string | null; what: string | null; source: 'one_off' | 'subscription';
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
      });
    }
  } catch (e) {
    return NextResponse.json({ error: `Stripe read failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
  missing.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  return NextResponse.json({ since: new Date(since * 1000).toISOString().slice(0, 10), missing }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  if (!stripe) return NextResponse.json({ error: 'STRIPE_SECRET_KEY is not set' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; action?: string };
  if ((body.kind !== 'checkout' && body.kind !== 'invoice') || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'kind (checkout|invoice) and id are required' }, { status: 400 });
  }
  if (body.action !== 'add' && body.action !== 'external') {
    return NextResponse.json({ error: 'action must be "add" or "external"' }, { status: 400 });
  }

  let draft: FiscalInvoiceDraft;
  const now = new Date();
  try {
    if (body.kind === 'checkout') {
      const s = await stripe.checkout.sessions.retrieve(body.id);
      if (!isOneOffSale(s)) return NextResponse.json({ error: 'Not a paid one-off sale' }, { status: 400 });
      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 20 });
      draft = fiscalDraftFromCheckout(s, items.data.map((i) => i.description ?? ''), { now, paidAt: new Date(s.created * 1000) });
    } else {
      const inv = await stripe.invoices.retrieve(body.id);
      if (!isFiscalSale(inv)) return NextResponse.json({ error: 'Not a paid subscription invoice' }, { status: 400 });
      const subId = inv.parent?.subscription_details?.subscription;
      const sub = subId ? await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id) : null;
      const custId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
      const cust = custId ? await stripe.customers.retrieve(custId) : null;
      const interval = sub?.items?.data?.[0]?.price?.recurring?.interval;
      draft = fiscalDraftFromInvoice(inv, cust && !('deleted' in cust && cust.deleted) ? (cust as Stripe.Customer) : null, {
        userId: sub?.metadata?.userId ?? null,
        plan: tierForPriceId(sub?.items?.data?.[0]?.price?.id) ?? sub?.metadata?.plan ?? null,
        interval: interval === 'month' || interval === 'year' ? interval : null,
        now,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: `Stripe read failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }

  const row = {
    ...draft,
    status: body.action === 'external' ? 'external' : 'to_issue',
    note: body.action === 'external' ? 'Already invoiced outside AngleMotion (marked on review)' : 'Added from the past-payments review',
  };
  const onConflict = draft.source === 'one_off' ? 'stripe_checkout_session_id' : 'stripe_invoice_id';
  const { error } = await access.db.from('fiscal_invoices').upsert(row, { onConflict, ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
