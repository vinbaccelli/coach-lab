import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { affiliateOverview } from '@/lib/affiliates.server';
import { normalizeAffiliateCode, normalizePct } from '@/lib/affiliates';

/** Admin: every affiliate with its totals and commissions. Same gate as /api/admin/invoices. */
export async function GET() {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  try {
    return NextResponse.json({ affiliates: await affiliateOverview(access.db) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load affiliates' }, { status: 500 });
  }
}

/** Admin: create an affiliate. Body: { name, code, pct, recurring }. The view token is random (43 chars). */
export async function POST(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; code?: unknown; pct?: unknown; recurring?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const code = normalizeAffiliateCode(body.code);
  const pct = normalizePct(body.pct);
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!code) return NextResponse.json({ error: 'Code: lowercase letters, digits and hyphens only (max 40)' }, { status: 400 });
  if (pct === null) return NextResponse.json({ error: 'Commission must be a number from 0 to 100' }, { status: 400 });
  const { data, error } = await access.db
    .from('affiliates')
    .insert({ name, code, commission_pct: pct, recurring: body.recurring === true, view_token: randomBytes(32).toString('base64url') })
    .select('id')
    .single();
  if (error) {
    const taken = error.code === '23505';
    return NextResponse.json({ error: taken ? `The code "${code}" is already used` : error.message }, { status: taken ? 409 : 500 });
  }
  return NextResponse.json({ id: data.id });
}
