import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';

/**
 * Admin: settle a commission. Body: { action: 'paid' | 'void' }. Only a
 * PENDING commission moves (the update is conditional on it), so a double
 * click or two tabs can't apply it twice.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const patch =
    body.action === 'paid' ? { status: 'paid', paid_at: new Date().toISOString() }
    : body.action === 'void' ? { status: 'void' }
    : null;
  if (!patch) return NextResponse.json({ error: 'action must be "paid" or "void"' }, { status: 400 });
  const { data, error } = await access.db.from('affiliate_commissions').update(patch).eq('id', id).eq('status', 'pending').select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found, or no longer pending' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
