import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRouteSession } from '@/lib/auth/routeSession';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

/**
 * Gate for /api/admin/invoices*: a signed-in ADMIN (lib/admin.ts) and the
 * service-role client (fiscal_invoices has no client policies). Returns the
 * client, or the Response to send back.
 */
export async function adminInvoicesAccess(): Promise<{ db: SupabaseClient } | { response: Response }> {
  const session = await getRouteSession();
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!isAdmin(session.email)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const db = createSupabaseServiceClient();
  if (!db) return { response: NextResponse.json({ error: 'Service client not configured' }, { status: 500 }) };
  return { db };
}

/** Columns the admin list shows (everything but the XML body). */
export const INVOICE_LIST_COLUMNS =
  'id, user_id, stripe_invoice_id, stripe_invoice_number, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, ' +
  'paid_at, amount_cents, currency, plan, billing_interval, period_start, period_end, customer_name, customer_email, ' +
  'business_name, customer_address, customer_country, customer_region, is_business, vat_id, vat_id_type, ' +
  'codice_fiscale, partita_iva, codice_destinatario, pec, description, tax_nature, tax_rate, regime_wording, ' +
  'stamp_duty_amount, invoice_year, invoice_number, invoice_date, xml_file_name, status, issued_at, sent_at, created_at';
