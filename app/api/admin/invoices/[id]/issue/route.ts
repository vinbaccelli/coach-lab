import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { romeToday } from '@/lib/billing/invoicing/settings';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import { buildFatturaPA, issueProblems, type InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

/**
 * Admin: issue one fiscal invoice — give it its number and date, freeze the
 * customer's identifiers, category, VAT treatment and amount breakdown (price,
 * VAT, stamp duty, total — D7) on it, and generate the FatturaPA XML. Only a 'to_issue' row can be issued; the (year, number) pair
 * is unique in SQL, so a number already used answers 409.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { number?: unknown; date?: unknown };
  const number = Number(body.number);
  const date = typeof body.date === 'string' && body.date ? body.date : romeToday();

  const { data: row, error } = await db.from('fiscal_invoices').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (row.status !== 'to_issue') return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
  if (date.slice(0, 10) < String(row.paid_at).slice(0, 10)) {
    return NextResponse.json({ error: 'The invoice date cannot be before the payment date' }, { status: 400 });
  }

  // The customer's Italian identifiers as they are now (entered on /billing).
  let profile: Record<string, string | null> = {};
  if (row.user_id) {
    const { data: p } = await db.from('billing_profiles').select('codice_fiscale, partita_iva, codice_destinatario, pec, foreign_tax_id').eq('user_id', row.user_id).maybeSingle();
    profile = (p ?? {}) as Record<string, string | null>;
  }
  const record: InvoiceRecord = {
    ...(row as InvoiceRecord),
    codice_fiscale: profile.codice_fiscale ?? row.codice_fiscale ?? null,
    partita_iva: profile.partita_iva ?? row.partita_iva ?? null,
    codice_destinatario: profile.codice_destinatario ?? row.codice_destinatario ?? null,
    pec: profile.pec ?? row.pec ?? null,
    foreign_tax_id: profile.foreign_tax_id ?? row.foreign_tax_id ?? null,
  };

  let settings;
  try {
    ({ settings } = await loadInvoiceSettings(db));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read invoice settings' }, { status: 500 });
  }
  const problems = issueProblems(record, settings, { number, date });
  if (problems.length) return NextResponse.json({ error: 'Cannot issue yet', problems }, { status: 422 });

  const built = buildFatturaPA(record, settings, { number, date });
  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await db
    .from('fiscal_invoices')
    .update({
      codice_fiscale: record.codice_fiscale,
      partita_iva: record.partita_iva,
      codice_destinatario: record.codice_destinatario,
      pec: record.pec,
      foreign_tax_id: record.foreign_tax_id,
      customer_category: built.category,
      ...built.amounts,
      description: built.description,
      tax_nature: built.nature,
      tax_rate: built.taxRate,
      regime_wording: settings.regimeWording,
      stamp_duty_amount: built.stampDuty,
      invoice_year: Number(date.slice(0, 4)),
      invoice_number: number,
      invoice_date: date,
      xml: built.xml,
      xml_file_name: built.fileName,
      status: 'issued',
      issued_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'to_issue') // never overwrite a row issued meanwhile
    .select('id, status, invoice_number, invoice_year, xml_file_name')
    .maybeSingle();
  if (upErr) {
    const taken = upErr.code === '23505';
    return NextResponse.json(
      { error: taken ? `Invoice number ${number}/${date.slice(0, 4)} is already used` : upErr.message },
      { status: taken ? 409 : 500 },
    );
  }
  if (!updated) return NextResponse.json({ error: 'It was issued meanwhile — reload' }, { status: 409 });
  return NextResponse.json({ invoice: updated });
}
