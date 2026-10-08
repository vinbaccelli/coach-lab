import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';

/**
 * Admin: move an issued invoice along.
 *  - "sent": Vin uploaded the XML to Fatture e Corrispettivi (final).
 *  - "unissue": back to 'to_issue', clearing number, date and XML — ONLY for
 *    an invoice that was never sent (e.g. a wrong number). A sent invoice is
 *    corrected with a credit note in the portal, never here.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const now = new Date().toISOString();

  const patch =
    action === 'sent'
      ? { status: 'sent', sent_at: now, updated_at: now }
      : action === 'unissue'
        ? {
            status: 'to_issue', invoice_year: null, invoice_number: null, invoice_date: null, xml: null,
            xml_file_name: null, issued_at: null, updated_at: now,
          }
        : null;
  if (!patch) return NextResponse.json({ error: 'action must be "sent" or "unissue"' }, { status: 400 });

  const { data, error } = await access.db
    .from('fiscal_invoices').update(patch).eq('id', id).eq('status', 'issued')
    .select('id, status').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Only an issued (not yet sent) invoice can change state' }, { status: 409 });
  return NextResponse.json({ invoice: data });
}
