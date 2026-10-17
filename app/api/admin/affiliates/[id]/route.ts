import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { normalizePct } from '@/lib/affiliates';

/**
 * Admin: edit an affiliate's commission %, recurring switch or active flag.
 * The code and the view token never change (they are in links already shared).
 * A new % applies to future commissions only: each row keeps its snapshot.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { pct?: unknown; recurring?: unknown; active?: unknown };
  const patch: Record<string, unknown> = {};
  if (body.pct !== undefined) {
    const pct = normalizePct(body.pct);
    if (pct === null) return NextResponse.json({ error: 'Commission must be a number from 0 to 100' }, { status: 400 });
    patch.commission_pct = pct;
  }
  if (typeof body.recurring === 'boolean') patch.recurring = body.recurring;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  const { data, error } = await access.db.from('affiliates').update(patch).eq('id', id).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
