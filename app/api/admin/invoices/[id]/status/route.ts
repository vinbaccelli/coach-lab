import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';

/**
 * Admin: move a record along. Each action is allowed only FROM the listed
 * statuses (the update is conditional on them, so a double click or two tabs
 * can't apply it twice):
 *  - "sent"     issued → sent: Vin uploaded the XML to Fatture e Corrispettivi
 *               and SdI accepted it. Optional `sdiId` (the SdI file identifier).
 *  - "unissue"  issued → to_issue, clearing number, date and XML — ONLY for an
 *               invoice never uploaded. A sent invoice is corrected with a
 *               credit note in the portal, never here.
 *  - "to_issue" review → to_issue: a past payment Vin confirms still needs an
 *               invoice from AngleMotion.
 *  - "external" review | to_issue → external: already invoiced outside
 *               AngleMotion (e.g. FatturAE). `reference` (e.g. "FatturAE 63/2026")
 *               is required, so the record proves where the invoice is.
 *  - "void"     review | to_issue → void: no invoice is to be issued (test,
 *               refunded before invoicing, not a sale). `reason` required.
 *  - "reopen"   void | external → review.
 */
const FROM: Record<string, string[]> = {
  sent: ['issued'], unissue: ['issued'], to_issue: ['review'], external: ['review', 'to_issue'],
  void: ['review', 'to_issue'], reopen: ['void', 'external'],
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; sdiId?: unknown; reference?: unknown; reason?: unknown };
  const action = body.action ?? '';
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  const now = new Date().toISOString();

  let patch: Record<string, unknown>;
  switch (action) {
    case 'sent':
      patch = { status: 'sent', sent_at: now, sdi_id: text(body.sdiId) || null };
      break;
    case 'unissue':
      patch = {
        status: 'to_issue', invoice_year: null, invoice_number: null, invoice_date: null, xml: null,
        xml_file_name: null, issued_at: null,
      };
      break;
    case 'to_issue':
      patch = { status: 'to_issue' };
      break;
    case 'external':
      if (!text(body.reference)) return NextResponse.json({ error: 'Say where it was invoiced, e.g. "FatturAE 63/2026"' }, { status: 400 });
      patch = { status: 'external', external_reference: text(body.reference) };
      break;
    case 'void':
      if (!text(body.reason)) return NextResponse.json({ error: 'Give a reason (e.g. "test payment", "refunded")' }, { status: 400 });
      patch = { status: 'void', void_reason: text(body.reason) };
      break;
    case 'reopen':
      patch = { status: 'review', void_reason: null, external_reference: null };
      break;
    default:
      return NextResponse.json({ error: `action must be one of: ${Object.keys(FROM).join(', ')}` }, { status: 400 });
  }

  const { data, error } = await access.db
    .from('fiscal_invoices').update({ ...patch, updated_at: now }).eq('id', id).in('status', FROM[action])
    .select('id, status').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `"${action}" is only possible from: ${FROM[action].join(', ')}` }, { status: 409 });
  return NextResponse.json({ invoice: data });
}
