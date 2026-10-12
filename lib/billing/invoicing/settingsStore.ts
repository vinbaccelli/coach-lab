import type { SupabaseClient } from '@supabase/supabase-js';
import { settingsFromRow, type InvoiceSettings, type InvoiceSettingsRow } from '@/lib/billing/invoicing/settings';

/**
 * Read the single invoice_settings row (service-role client only — the table
 * has no client policies). A missing row reads as the SQL defaults.
 */
export async function loadInvoiceSettings(db: SupabaseClient): Promise<{ row: Partial<InvoiceSettingsRow> | null; settings: InvoiceSettings }> {
  const { data, error } = await db.from('invoice_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`invoice_settings read failed: ${error.message}`);
  const row = (data ?? null) as Partial<InvoiceSettingsRow> | null;
  return { row, settings: settingsFromRow(row) };
}
