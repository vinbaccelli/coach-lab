import { NextResponse } from 'next/server';
import { adminInvoicesAccess, INVOICE_LIST_COLUMNS } from '@/lib/billing/invoicing/adminAccess';
import { invoiceSettings, romeToday, settingsProblems, suggestInvoiceNumber } from '@/lib/billing/invoicing/settings';
import { issueProblems, type InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

/**
 * Admin: every fiscal invoice record (newest first), what each still needs
 * before it can be issued, and the number to propose next. ?format=csv
 * downloads the same list for the accountant.
 */
export async function GET(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;

  const { data, error } = await db.from('fiscal_invoices').select(INVOICE_LIST_COLUMNS).order('paid_at', { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: `Could not read invoices: ${error.message}` }, { status: 500 });
  const rows = (data ?? []) as unknown as Array<InvoiceRecord & Record<string, unknown>>;

  // Customers' current Italian identifiers (they may add them after paying).
  const userIds = [...new Set(rows.filter((r) => r.status === 'to_issue' && r.user_id).map((r) => r.user_id as string))];
  const profiles = new Map<string, Record<string, string | null>>();
  if (userIds.length) {
    const { data: p } = await db.from('billing_profiles').select('user_id, codice_fiscale, partita_iva, codice_destinatario, pec').in('user_id', userIds);
    for (const row of p ?? []) profiles.set(row.user_id as string, row as Record<string, string | null>);
  }

  const settings = invoiceSettings();
  const year = Number(romeToday().slice(0, 4));
  const { data: maxRow } = await db
    .from('fiscal_invoices').select('invoice_number').eq('invoice_year', year).not('invoice_number', 'is', null)
    .order('invoice_number', { ascending: false }).limit(1).maybeSingle<{ invoice_number: number }>();

  const invoices = rows.map((r) => {
    const merged = r.status === 'to_issue' && r.user_id ? { ...r, ...stripNulls(profiles.get(r.user_id as string)) } : r;
    return {
      ...merged,
      problems: r.status === 'to_issue' ? issueProblems(merged, settings).filter((p) => !settingsProblems(settings).includes(p)) : [],
    };
  });

  if (new URL(req.url).searchParams.get('format') === 'csv') return csv(invoices);

  return NextResponse.json(
    {
      invoices,
      year,
      today: romeToday(),
      suggestedNumber: suggestInvoiceNumber(settings, year, maxRow?.invoice_number ?? null),
      settingsProblems: settingsProblems(settings),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function stripNulls(o: Record<string, string | null> | undefined) {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => v !== null && k !== 'user_id'));
}

const CSV_COLUMNS = [
  'status', 'invoice_year', 'invoice_number', 'invoice_date', 'paid_at', 'amount_cents', 'currency', 'plan', 'billing_interval',
  'period_start', 'period_end', 'customer_name', 'business_name', 'customer_email', 'customer_country', 'customer_region',
  'is_business', 'vat_id', 'codice_fiscale', 'partita_iva', 'codice_destinatario', 'pec', 'tax_nature', 'stamp_duty_amount',
  'stripe_invoice_id', 'stripe_payment_intent_id', 'stripe_customer_id', 'stripe_subscription_id',
] as const;

function csv(rows: Array<Record<string, unknown>>) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(','))].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="anglemotion-invoices-${romeToday()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
