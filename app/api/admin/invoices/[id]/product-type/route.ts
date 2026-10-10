import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { PRODUCT_TYPES, type ProductType } from '@/lib/billing/invoicing/settings';

/**
 * Admin: set what a one-off sale is (coaching / video analysis, ebook /
 * digital product, other) — the VAT treatment depends on it, so it is never
 * guessed. The choice is remembered for the sale's Stripe products
 * (invoice_product_types), so later payments for the same product arrive
 * classified, and it is applied to the other not-yet-invoiced records for
 * exactly the same products. Subscriptions are always the software product.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { productType?: string; remember?: boolean };
  const productType = body.productType as ProductType;
  if (!PRODUCT_TYPES.includes(productType)) {
    return NextResponse.json({ error: `productType must be one of: ${PRODUCT_TYPES.join(', ')}` }, { status: 400 });
  }

  const { data: row, error } = await db.from('fiscal_invoices').select('id, source, status, stripe_product_ids, product_description').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (row.source === 'subscription') return NextResponse.json({ error: 'A subscription is always the Anglemotion software product' }, { status: 400 });
  if (row.status !== 'to_issue' && row.status !== 'review') {
    return NextResponse.json({ error: `This record is "${row.status}": its product type is frozen` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: upErr } = await db.from('fiscal_invoices').update({ product_type: productType, updated_at: now }).eq('id', id).in('status', ['to_issue', 'review']);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const ids = (row.stripe_product_ids as string[] | null) ?? [];
  let applied = 0;
  if (body.remember !== false && ids.length) {
    const { error: mapErr } = await db.from('invoice_product_types').upsert(
      ids.map((pid) => ({ stripe_product_id: pid, product_type: productType, label: row.product_description, updated_at: now })),
      { onConflict: 'stripe_product_id' },
    );
    if (mapErr) return NextResponse.json({ error: `Saved on this record, but not remembered: ${mapErr.message}` }, { status: 500 });
    const { data: others } = await db
      .from('fiscal_invoices').update({ product_type: productType, updated_at: now })
      .in('status', ['to_issue', 'review']).is('product_type', null)
      .contains('stripe_product_ids', ids).containedBy('stripe_product_ids', ids)
      .select('id');
    applied = others?.length ?? 0;
  }
  return NextResponse.json({ ok: true, productType, remembered: body.remember !== false && ids.length > 0, appliedToOthers: applied });
}
