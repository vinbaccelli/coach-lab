import type { SupabaseClient } from '@supabase/supabase-js';
import { PROFILE_COLUMNS } from '@/lib/billing/invoicing/adminAccess';
import type { InvoiceRecord } from '@/lib/billing/invoicing/fatturaPA';

/**
 * Shared reads for the admin invoice routes (issue, preview, list): a record
 * with the customer's CURRENT identifiers from billing_profiles (they may add
 * them on /billing after paying), and the last number/date issued here.
 */

export type InvoiceRow = InvoiceRecord & Record<string, unknown> & { id: string; status: string; user_id: string | null };

const PROFILE_FIELDS = ['codice_fiscale', 'partita_iva', 'codice_destinatario', 'pec', 'foreign_tax_id'] as const;

/** The row with the profile's non-empty identifiers laid over it. */
export function withProfile<T extends Record<string, unknown>>(row: T, profile: Record<string, unknown> | null | undefined): T {
  if (!profile) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of PROFILE_FIELDS) if (profile[k] !== null && profile[k] !== undefined && profile[k] !== '') out[k] = profile[k];
  return out as T;
}

export async function loadRecord(db: SupabaseClient, id: string): Promise<{ row: InvoiceRow | null; error?: string }> {
  const { data: row, error } = await db.from('fiscal_invoices').select('*').eq('id', id).maybeSingle();
  if (error) return { row: null, error: error.message };
  if (!row) return { row: null };
  let profile: Record<string, unknown> | null = null;
  if (row.user_id) {
    const { data: p } = await db.from('billing_profiles').select(PROFILE_COLUMNS).eq('user_id', row.user_id).maybeSingle();
    profile = (p ?? null) as Record<string, unknown> | null;
  }
  return { row: withProfile(row as InvoiceRow, profile) };
}

/** Highest invoice number and latest invoice date issued here in `year`. */
export async function lastIssuedHere(db: SupabaseClient, year: number): Promise<{ number: number | null; date: string | null }> {
  const [num, date] = await Promise.all([
    db.from('fiscal_invoices').select('invoice_number').eq('invoice_year', year).not('invoice_number', 'is', null)
      .order('invoice_number', { ascending: false }).limit(1).maybeSingle<{ invoice_number: number }>(),
    db.from('fiscal_invoices').select('invoice_date').eq('invoice_year', year).not('invoice_date', 'is', null)
      .order('invoice_date', { ascending: false }).limit(1).maybeSingle<{ invoice_date: string }>(),
  ]);
  if (num.error) throw new Error(num.error.message);
  if (date.error) throw new Error(date.error.message);
  return { number: num.data?.invoice_number ?? null, date: date.data?.invoice_date ?? null };
}
