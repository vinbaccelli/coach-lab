import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';

/** Admin: download an issued invoice's FatturaPA XML, named as SdI expects. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { id } = await ctx.params;
  const { data, error } = await access.db.from('fiscal_invoices').select('xml, xml_file_name').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.xml) return NextResponse.json({ error: 'Not issued yet' }, { status: 404 });
  return new Response(data.xml as string, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${data.xml_file_name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
