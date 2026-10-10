import { NextResponse } from 'next/server';
import { adminInvoicesAccess, INVOICE_LIST_COLUMNS, PROFILE_COLUMNS } from '@/lib/billing/invoicing/adminAccess';
import { loadInvoiceSettings } from '@/lib/billing/invoicing/settingsStore';
import { romeToday, settingsProblems, suggestInvoiceNumber } from '@/lib/billing/invoicing/settings';
import { issueProblems, recordCategory, type InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

/**
 * Admin: every fiscal invoice record (newest first) — subscriptions and
 * one-off sales — what each still needs before it can be issued, the number
 * to propose next, and this year's EU-private-customer sales (the OSS
 * threshold question, T2). ?format=csv downloads the list for the accountant.
 */
export async function GET(req: Request) {
  const access = await adminInvoicesAccess();
  if ('response' in access) return access.response;
  const { db } = access;

  const { data, error } = await db.from('fiscal_invoices').select(INVOICE_LIST_COLUMNS).order('paid_at', { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: `Could not read invoices: ${error.message}` }, { status: 500 });
  const rows = (data ?? []) as unknown as Array<InvoiceRecord & Record<string, unknown>>;

  const userIds = [...new Set(rows.filter((r) => r.status === 'to_issue' && r.user_id).map((r) => r.user_id as string))];
  const profiles = new Map<string, Record<string, string | null>>();
  if (userIds.length) {
    const { data: p } = await db.from('billing_profiles').select(PROFILE_COLUMNS).in('user_id', userIds);
    for (const row of p ?? []) profiles.set(row.user_id as string, row as Record<string, string | null>);
  }

  let settings;
  try {
    ({ settings } = await loadInvoiceSettings(db));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read invoice settings' }, { status: 500 });
  }
  const globalProblems = settingsProblems(settings);
  const year = Number(romeToday().slice(0, 4));
  const { data: maxRow } = await db
    .from('fiscal_invoices').select('invoice_number').eq('invoice_year', year).not('invoice_number', 'is', null)
    .order('invoice_number', { ascending: false }).limit(1).maybeSingle<{ invoice_number: number }>();

  const invoices: Array<Record<string, unknown> & { problems: string[] }> = rows.map((r) => {
    const merged = r.status === 'to_issue' && r.user_id ? { ...r, ...stripNulls(profiles.get(r.user_id as string)) } : r;
    return {
      ...merged,
      customer_category: r.status === 'to_issue' ? recordCategory(merged) : r.customer_category,
      problems: r.status === 'to_issue' ? issueProblems(merged, settings).filter((p) => !globalProblems.includes(p)) : [],
    };
  });

  // EU private customers this calendar year, any status but 'external' (T2 / OSS threshold).
  const euB2cCents = invoices
    .filter((i) => i.customer_category === 'EU_B2C' && String(i.paid_at).startsWith(String(year)) && i.status !== 'external')
    .reduce((sum, i) => sum + (i.amount_cents as number), 0);

  if (new URL(req.url).searchParams.get('format') === 'csv') return csv(invoices);

  return NextResponse.json(
    {
      invoices,
      year,
      today: romeToday(),
      suggestedNumber: suggestInvoiceNumber(settings, year, maxRow?.invoice_number ?? null),
      settingsProblems: globalProblems,
      euB2cThisYearCents: euB2cCents,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function stripNulls(o: Record<string, string | null> | undefined) {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => v !== null && k !== 'user_id'));
}

const CSV_COLUMNS = [
  'status', 'source', 'invoice_year', 'invoice_number', 'invoice_date', 'paid_at', 'currency',
  'taxable_amount_cents', 'vat_amount_cents', 'stamp_duty_cents', 'invoice_total_cents', 'amount_cents',
  'plan', 'billing_interval', 'product_description', 'period_start', 'period_end',
  'customer_name', 'business_name', 'customer_email', 'customer_country', 'customer_category',
  'vat_id', 'foreign_tax_id', 'codice_fiscale', 'partita_iva', 'codice_destinatario', 'pec', 'tax_nature', 'note',
  'stripe_invoice_id', 'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_customer_id', 'stripe_subscription_id',
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
