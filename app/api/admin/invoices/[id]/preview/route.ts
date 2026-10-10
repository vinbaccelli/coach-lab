import { NextResponse } from 'next/server';
import { adminInvoicesAccess } from '@/lib/billing/invoicing/adminAccess';
import { romeToday, sequenceProblems, suggestInvoiceNumber } from '@/lib/billing/invoicing/settings';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import { prepareInvoice } from '@/lib/billing/invoicing/fatturaPA';
import { lastIssuedHere, loadRecord } from '@/lib/billing/invoicing/records';

/**
 * Admin: PREVIEW the invoice a record would become — the XML and the
 * pre-issue checklist (supplier, customer, numbering, Natura/rate, amounts vs
 * the Stripe payment, stamp duty, foreign identification) plus every reason it
 * can't be issued yet. Writes nothing; works for test-mode payments and while
 * rules are pending. A preview is not an invoice.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { number?: unknown; date?: unknown; confirmGap?: unknown };
  const date = typeof body.date === 'string' && body.date ? body.date : romeToday();
  const year = Number(date.slice(0, 4));

  const { row, error } = await loadRecord(db, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  let settings;
  let last;
  try {
    ({ settings } = await loadInvoiceSettings(db));
    last = await lastIssuedHere(db, year);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read invoice settings' }, { status: 500 });
  }
  const suggested = suggestInvoiceNumber(settings, year, last.number);
  const number = Number(body.number) || suggested;
  const prepared = prepareInvoice(row, settings, { number, date });
  const seq = row.status === 'to_issue' || row.status === 'review'
    ? sequenceProblems(settings, { number, date, confirmGap: body.confirmGap === true }, last)
    : { problems: [], gapFrom: null };
  const statusProblem = row.status === 'to_issue' ? [] : [`This record is "${row.status}": only a "to issue" record can be issued`];
  const problems = [...statusProblem, ...prepared.problems, ...seq.problems];

  return NextResponse.json(
    {
      preview: true,
      number,
      date,
      suggestedNumber: suggested,
      gapFrom: seq.gapFrom,
      category: prepared.category,
      problems,
      checks: [
        ...prepared.checks.filter((c) => c.label !== 'Ready to issue'),
        { label: `Number ${number}/${year}, date ${date}: in sequence`, ok: seq.problems.length === 0, detail: seq.problems.join(' ') || undefined },
        { label: 'Not already invoiced (one record per Stripe payment)', ok: row.status !== 'external' && row.status !== 'void' },
        { label: 'Ready to issue', ok: problems.length === 0, detail: problems.length ? `${problems.length} problem(s) to resolve` : undefined },
      ],
      xml: prepared.built?.xml ?? null,
      fileName: prepared.built?.fileName ?? null,
      amounts: prepared.built?.amounts ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
