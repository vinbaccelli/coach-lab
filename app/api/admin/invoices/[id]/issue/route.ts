import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { romeToday, sequenceProblems } from '@/lib/billing/invoicing/settings';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import { prepareInvoice, recordProductType } from '@/lib/billing/invoicing/fatturaPA';
import { lastIssuedHere, loadRecord } from '@/lib/billing/invoicing/records';

/**
 * Admin: issue one fiscal invoice — give it its number and date, freeze the
 * customer's identifiers, category, product type, VAT treatment, wording and
 * amount breakdown (price, VAT, stamp duty, total — D7) on it, and store the
 * FatturaPA XML.
 *
 * Refused (422, with the reasons) while anything is missing or any rule it
 * depends on is still awaiting the commercialista, for test-mode payments,
 * and when the number/date break the sequence (a skipped number needs
 * `confirmGap`). Only a 'to_issue' row can be issued; (year, number) is
 * unique in SQL, so two issues racing for the same number → one gets 409.
 *
 * "Issued" means the XML exists here. It is NOT transmitted: Vin uploads it to
 * Fatture e Corrispettivi and then marks it sent.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { number?: unknown; date?: unknown; confirmGap?: unknown };
  const number = Number(body.number);
  const date = typeof body.date === 'string' && body.date ? body.date : romeToday();

  const { row, error } = await loadRecord(db, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (row.status !== 'to_issue') return NextResponse.json({ error: `This record is "${row.status}", not "to issue"` }, { status: 409 });
  if (date.slice(0, 10) < String(row.paid_at).slice(0, 10)) {
    return NextResponse.json({ error: 'The invoice date cannot be before the payment date' }, { status: 400 });
  }

  let settings;
  let last;
  try {
    ({ settings } = await loadInvoiceSettings(db));
    last = await lastIssuedHere(db, Number(date.slice(0, 4)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read invoice settings' }, { status: 500 });
  }
  const prepared = prepareInvoice(row, settings, { number, date });
  const seq = sequenceProblems(settings, { number, date, confirmGap: body.confirmGap === true }, last);
  const problems = [...prepared.problems, ...seq.problems];
  if (problems.length || !prepared.built) {
    return NextResponse.json({ error: 'Cannot issue yet', problems, gapFrom: seq.gapFrom }, { status: 422 });
  }

  const built = prepared.built;
  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await db
    .from('fiscal_invoices')
    .update({
      codice_fiscale: row.codice_fiscale ?? null,
      partita_iva: row.partita_iva ?? null,
      codice_destinatario: row.codice_destinatario ?? null,
      pec: row.pec ?? null,
      foreign_tax_id: row.foreign_tax_id ?? null,
      product_type: recordProductType(row),
      customer_category: built.category,
      ...built.amounts,
      description: built.description,
      tax_nature: built.nature,
      tax_rate: built.taxRate,
      regime_wording: settings.wording,
      stamp_duty_amount: built.stampDuty,
      invoice_year: Number(date.slice(0, 4)),
      invoice_number: number,
      invoice_date: date,
      xml: built.xml,
      xml_file_name: built.fileName,
      note: seq.gapFrom !== null ? [row.note, `Number gap from ${seq.gapFrom} confirmed on issue`].filter(Boolean).join(' · ') : row.note ?? null,
      status: 'issued',
      issued_at: now,
      last_error: null,
      last_error_at: null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'to_issue') // never overwrite a row issued meanwhile
    .select('id, status, invoice_number, invoice_year, xml_file_name')
    .maybeSingle();
  if (upErr) {
    const taken = upErr.code === '23505';
    return NextResponse.json(
      { error: taken ? `Invoice number ${number}/${date.slice(0, 4)} is already used — reload for the next free number` : upErr.message },
      { status: taken ? 409 : 500 },
    );
  }
  if (!updated) return NextResponse.json({ error: 'It was issued meanwhile — reload' }, { status: 409 });
  return NextResponse.json({ invoice: updated });
}
